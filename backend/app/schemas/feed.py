import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import AuditEvent


class FeedEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # None once the underlying ticket is deleted (feed rows are detached, R14)
    ticket_id: uuid.UUID | None
    event: AuditEvent
    actor_username: str
    employee_username: str
    truck_number: str
    mc_name: str
    message: str
    created_at: datetime
