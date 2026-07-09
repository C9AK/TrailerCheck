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

    trailer = db.scalar(
        select(Trailer).where(Trailer.trailer_number == payload.trailer_number)
    )
    if trailer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Trailer '{payload.trailer_number}' not found.",
        )

    if payload.last_pti_date_override is not None:
        trailer.last_pti_date = _as_utc(payload.last_pti_date_override)

    return trailer


def _pti_gate_passed(ticket: PickupTicket) -> bool:
    if ticket.pti_verified:
        return True
    if ticket.is_lot_trailer and ticket.trailer is not None:
        age = datetime.now(timezone.utc) - _as_utc(ticket.trailer.last_pti_date)
        return age < LOT_PTI_WINDOW
    return False


def is_ready_for_qc(ticket: PickupTicket) -> bool:
    """All required fields complete -> eligible for PENDING_QC."""
    if not (
        ticket.registration_verified
        and ticket.inspection_paper_verified
        and ticket.sticker_verified
        and ticket.bol_present
    ):
        return False
    if ticket.needs_scale and not ticket.scale_ticket_received:
        return False
    return _pti_gate_passed(ticket)
