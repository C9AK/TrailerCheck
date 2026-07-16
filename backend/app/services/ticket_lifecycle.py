"""State machine + PTI business rules.

Revision R2: PTI is NO LONGER required to save a ticket (it may sit in
AWAITING_DRIVER unchecked), but it gates the transition to PENDING_QC:
  - Standard pickup: pti_verified must be true.
  - LOT trailer: pti_verified true OR the trailer's last_pti_date is < 7 days
    old at the moment of the transition.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PickupTicket, Trailer
from app.schemas.ticket import TicketCreate

LOT_PTI_WINDOW = timedelta(days=7)


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def resolve_trailer_by_number(
    db: Session, trailer_number: str, last_pti_date_override: datetime | None
) -> Trailer:
    """Resolve a LOT trailer by number, registering it on the fly if unknown
    (R7: LOT bypasses fleet validation). Persists any manual PTI override."""
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
            is_lot_trailer=True,
        )
        db.add(trailer)
        db.flush()
        return trailer

    if last_pti_date_override is not None:
        trailer.last_pti_date = _as_utc(last_pti_date_override)

    return trailer


def resolve_lot_trailer(db: Session, payload: TicketCreate) -> Trailer | None:
    """For LOT tickets, resolve (and require) the trailer record; persist any
    manual last_pti_date override. Raises 400/404. Returns None for standard."""
    if not payload.is_lot_trailer:
        return None

    if not payload.trailer_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LOT Trailer tickets require a trailer_number.",
        )

    return resolve_trailer_by_number(db, payload.trailer_number, payload.last_pti_date_override)


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
