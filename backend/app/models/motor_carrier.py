import uuid

from sqlalchemy import String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class MotorCarrier(Base):
    __tablename__ = "motor_carriers"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    api_endpoint: Mapped[str] = mapped_column(String(500), nullable=False)
    # Stored encrypted at rest; only ever returned masked to the manager UI.
    api_key: Mapped[str] = mapped_column(String(500), nullable=False)

    tickets: Mapped[list["PickupTicket"]] = relationship(  # noqa: F821
        back_populates="motor_carrier"
    )
