import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import AuditEvent


class FeedEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    event: AuditEvent
    actor_username: str
    employee_username: str
    truck_number: str
    mc_name: str
    message: str
    created_at: datetime
