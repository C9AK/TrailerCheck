import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TrailerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    trailer_number: str
    last_pti_date: datetime
    is_lot_trailer: bool
