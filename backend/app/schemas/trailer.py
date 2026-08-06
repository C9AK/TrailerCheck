import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import TrailerDocType


class TrailerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    trailer_number: str
    last_pti_date: datetime
    is_lot_trailer: bool


class TrailerDocumentOut(BaseModel):
    """R25: a persisted trailer paper (inspection/registration)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    trailer_id: uuid.UUID
    doc_type: TrailerDocType
    media_url: str
    uploaded_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class LastUsedOut(BaseModel):
    """R43: which truck had this trailer last, and when — shown as a small
    info line the moment a trailer number is entered, LOT or not."""

    truck_number: str
    created_at: datetime


class LastPickupByTruckOut(BaseModel):
    """R46: "still using trailer XXXX?" — a snapshot of a truck's most recent
    pickup (trailer identity, PTI date, saved papers, and what was verified
    last time) shown as a confirmation prompt the moment a truck number is
    entered on New Pickup."""

    trailer_number: str
    last_pti_date: datetime
    pti_verified: bool
    registration_verified: bool
    inspection_paper_verified: bool
    sticker_verified: bool
    documents: list[TrailerDocumentOut]
    created_at: datetime
