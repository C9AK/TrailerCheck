import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserBrief


class TrailerIssueCreate(BaseModel):
    """R44: QC reports a trailer problem — free text, no category needed.
    Not a flag: never touches the employee's score, doesn't block approval."""

    description: str = Field(min_length=3, max_length=2000)


class TrailerIssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID | None
    trailer_id: uuid.UUID | None
    truck_number: str
    trailer_number: str | None
    mc_name: str
    description: str
    reported_by: uuid.UUID
    reporter: UserBrief
    is_resolved: bool
    resolved_by: uuid.UUID | None
    resolver: UserBrief | None
    resolved_at: datetime | None
    created_at: datetime
