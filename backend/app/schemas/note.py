import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import NoteStatus
from app.schemas.user import UserBrief


class NoteCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class NoteUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by: uuid.UUID
    creator: UserBrief
    content: str
    truck_number: str | None
    mc_name: str | None
    is_auto_generated: bool
    status: NoteStatus
    resolved_by: uuid.UUID | None
    resolver: UserBrief | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class AutoNoteOut(BaseModel):
    """Computed (not yet persisted) handover note. R22: ONE note per truck,
    consolidating every missing item; ticket_id links back so publish can
    mark the ticket's auto_note_generated flag."""

    ticket_id: uuid.UUID
    truck_number: str
    mc_name: str
    missing_items: list[str]
    content: str


class DraftsOut(BaseModel):
    auto_notes: list[AutoNoteOut]
    manual_drafts: list[NoteOut]


class PublishResult(BaseModel):
    published_auto: int
    published_manual: int
    skipped_duplicates: int
