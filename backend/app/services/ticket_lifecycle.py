"""State machine + PTI business rules.

Revision R2: PTI is NO LONGER required to save a ticket (it may sit in
AWAITING_DRIVER unchecked), but it gates the transition to PENDING_QC:
  - Standard pickup: pti_verified must be true.
  - LOT trailer: pti_verified true OR the trailer's last_pti_date is < 7 days
    old at the moment of the transition.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditEvent, AuditLog, PickupTicket, Trailer
from app.schemas.ticket import TicketCreate

LOT_PTI_WINDOW = timedelta(days=7)


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def resolve_trailer_by_number(
    db: Session,
    trailer_number: str,
    last_pti_date_override: datetime | None,
    register_as_lot: bool = True,
) -> Trailer:
    """Resolve a trailer by number, registering it on the fly if unknown
    (R7: LOT bypasses fleet validation; R25: standard pickups register too so
    their papers persist). Persists any manual PTI override."""
    number = trailer_number.strip()
    trailer = db.scalar(select(Trailer).where(Trailer.trailer_number == number))
    if trailer is None:
        # Without a PTI date the trailer starts "stale" so the PTI gate still
        # applies.
        trailer = Trailer(
            trailer_number=number,
            last_pti_date=_as_utc(last_pti_date_override)
            if last_pti_date_override
            else datetime.now(timezone.utc) - LOT_PTI_WINDOW,
            is_lot_trailer=register_as_lot,
        )
        db.add(trailer)
        db.flush()
        return trailer

    if last_pti_date_override is not None:
        trailer.last_pti_date = _as_utc(last_pti_date_override)

    return trailer


def rename_or_relink_trailer(
    db: Session,
    ticket: PickupTicket,
    new_number: str,
    last_pti_date_override: datetime | None,
    register_as_lot: bool,
) -> Trailer:
    """R39: editing an ALREADY-LINKED ticket's trailer number is, in practice,
    almost always a typo fix (QC/Carryover quick-edit) — not a request to
    swap onto a genuinely different physical trailer. resolve_trailer_by_number
    would find-or-create a DIFFERENT Trailer row for the new number and
    re-point the ticket at it, silently orphaning the old trailer's saved
    documents (they stay attached to the old number, which now has no
    ticket referencing it). Instead, rename the EXISTING trailer record in
    place — same id, so its persisted documents follow automatically — unless
    the corrected number already belongs to a DIFFERENT known trailer, in
    which case link to that one (it already has its own identity/papers,
    which is the right outcome there, and renaming over it would collide
    with trailer_number's unique constraint anyway)."""
    number = new_number.strip()
    current = ticket.trailer
    if current is None or current.trailer_number == number:
        return resolve_trailer_by_number(
            db, number, last_pti_date_override, register_as_lot=register_as_lot
        )

    clash = db.scalar(select(Trailer).where(Trailer.trailer_number == number))
    if clash is not None:
        if last_pti_date_override is not None:
            clash.last_pti_date = _as_utc(last_pti_date_override)
        return clash

    current.trailer_number = number
    if last_pti_date_override is not None:
        current.last_pti_date = _as_utc(last_pti_date_override)
    return current


def resolve_ticket_trailer(db: Session, payload: TicketCreate) -> Trailer | None:
    """Resolve the ticket's trailer record at creation. LOT tickets REQUIRE a
    trailer_number (400 otherwise); R25: standard pickups link one too when
    the dispatcher typed a trailer number, so its saved papers attach across
    pickups. Returns None only when no trailer number was given."""
    number = (payload.trailer_number or "").strip()
    if payload.is_lot_trailer and not number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LOT Trailer tickets require a trailer_number.",
        )
    if not number:
        return None

    return resolve_trailer_by_number(
        db,
        number,
        payload.last_pti_date_override,
        register_as_lot=payload.is_lot_trailer,
    )


def _pti_gate_passed(ticket: PickupTicket) -> bool:
    if ticket.pti_verified:
        return True
    if ticket.is_lot_trailer and ticket.trailer is not None:
        age = datetime.now(timezone.utc) - _as_utc(ticket.trailer.last_pti_date)
        return age < LOT_PTI_WINDOW
    return False


def get_last_pti_date(db: Session, ticket: PickupTicket) -> datetime | None:
    """R20 (fixed): historical context for QC Review — the most recent known
    PTI check for this truck/trailer, from EITHER source:
      - the trailer's own last_pti_date (LOT trailers track this directly —
        it's set at intake/override and is the SAME field the 7-day gate
        reads, so it must win even when no ticket has ever verified it), or
      - the most recent OTHER ticket for the same truck/trailer with the
        master PTI checkbox verified.
    Whichever is more recent is returned. Matched by trailer_id when the
    ticket has one (LOT trailers, a stable identity), otherwise by
    truck_number (standard pickups, which have no trailer entity at all)."""
    candidates: list[datetime] = []

    if ticket.trailer_id is not None and ticket.trailer is not None:
        candidates.append(_as_utc(ticket.trailer.last_pti_date))

    q = select(PickupTicket.created_at).where(
        PickupTicket.pti_verified.is_(True),
        PickupTicket.id != ticket.id,
    )
    if ticket.trailer_id is not None:
        q = q.where(PickupTicket.trailer_id == ticket.trailer_id)
    else:
        q = q.where(PickupTicket.truck_number == ticket.truck_number)
    q = q.order_by(PickupTicket.created_at.desc()).limit(1)
    historical = db.scalar(q)
    if historical is not None:
        candidates.append(_as_utc(historical))

    return max(candidates) if candidates else None


def get_last_hauled_truck_for_trailer(
    db: Session,
    trailer_id: uuid.UUID,
    exclude_ticket_id: uuid.UUID | None = None,
) -> tuple[str, datetime] | None:
    """R51: which truck most recently hauled this trailer, and when — the
    shared query behind both GET /api/trailers/{number}/last-used (R43,
    used on the New Pickup form before a ticket necessarily exists yet) and
    GET /api/tickets/qc's per-ticket `last_hauled_truck_number` context
    (below). Kept as one function so the "most recent OTHER pickup for this
    trailer_id" definition can't drift between the two call sites."""
    q = (
        select(PickupTicket.truck_number, PickupTicket.created_at)
        .where(PickupTicket.trailer_id == trailer_id)
        .order_by(PickupTicket.created_at.desc())
        .limit(1)
    )
    if exclude_ticket_id is not None:
        q = q.where(PickupTicket.id != exclude_ticket_id)
    row = db.execute(q).first()
    if row is None:
        return None
    truck_number, created_at = row
    return truck_number, _as_utc(created_at)


def get_last_hauled_truck(
    db: Session, ticket: PickupTicket
) -> tuple[str, datetime] | None:
    """R51: historical context for the QC Review card — a trailer new to
    THIS truck is not necessarily new to the fleet; another truck may have
    hauled it recently with a fully verified PTI on record. Without this,
    QC (and the dispatcher creating the ticket) has no way to tell "genuinely
    unknown trailer" apart from "this truck just hasn't seen it before," which
    produces false missing/stale-PTI flags. Matched by trailer_id only, same
    as get_last_qc_approved_date — this is about the trailer's own haul
    history, not whichever truck happens to be reviewing it today. None for
    tickets with no linked trailer, or one no other ticket has ever
    referenced. Only populated by GET /api/tickets/qc."""
    if ticket.trailer_id is None:
        return None
    return get_last_hauled_truck_for_trailer(db, ticket.trailer_id, exclude_ticket_id=ticket.id)


def get_last_qc_approved_date(db: Session, ticket: PickupTicket) -> datetime | None:
    """R47: historical context for QC Review — the most recent time a
    DIFFERENT ticket for this SAME physical trailer was approved by QC. Matched by
    trailer_id only (no truck_number fallback — this is about the trailer's
    own audit history, not whichever truck happened to pull it); tickets
    with no trailer linked have no comparable history."""
    if ticket.trailer_id is None:
        return None
    q = (
        select(AuditLog.created_at)
        .join(PickupTicket, AuditLog.ticket_id == PickupTicket.id)
        .where(
            AuditLog.event == AuditEvent.TICKET_APPROVED,
            PickupTicket.trailer_id == ticket.trailer_id,
            PickupTicket.id != ticket.id,
        )
        .order_by(AuditLog.created_at.desc())
        .limit(1)
    )
    result = db.scalar(q)
    return _as_utc(result) if result is not None else None


def is_ready_for_qc(ticket: PickupTicket) -> bool:
    """All required fields complete -> eligible for PENDING_QC.
    R8: inspection paper OR sticker suffices (either one, not both)."""
    if not (
        ticket.registration_verified
        and (ticket.inspection_paper_verified or ticket.sticker_verified)
        and ticket.bol_present
    ):
        return False
    if ticket.needs_scale and not ticket.scale_ticket_received:
        return False
    return _pti_gate_passed(ticket)
