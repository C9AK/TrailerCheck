import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import TicketState, TrailerCondition


class PickupTicket(Base):
    __tablename__ = "pickup_tickets"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    mc_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("motor_carriers.id"), nullable=False, index=True
    )
    truck_number: Mapped[str] = mapped_column(String(100), nullable=False)
    # LOT identity persisted so the 7-day PTI rule is evaluated at the
    # AWAITING_DRIVER -> PENDING_QC transition, not only at creation.
    is_lot_trailer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    trailer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("trailers.id"), nullable=True, index=True
    )
    state: Mapped[TicketState] = mapped_column(
        Enum(TicketState, name="ticket_state"),
        nullable=False,
        default=TicketState.DRAFT,
        index=True,
    )

    # Telematics data (auto-filled from the MC fleet API; empty while DRAFT)
    driver_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    truck_location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    truck_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    truck_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    truck_model: Mapped[str | None] = mapped_column(String(200), nullable=True)  # "YEAR MAKE MODEL"
    fuel_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Checklist fields
    registration_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    inspection_paper_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sticker_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_ca_fl_destination: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tires_inspected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    bol_present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    trailer_condition: Mapped[TrailerCondition | None] = mapped_column(
        Enum(TrailerCondition, name="trailer_condition"), nullable=True
    )
    condition_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    needs_scale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    scale_ticket_received: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Drives the Carryover dashboard 60/120-minute timer UI
    scale_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # PTI verification - strictly a checkbox, no file uploads
    pti_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    creator: Mapped["User"] = relationship(  # noqa: F821
        back_populates="tickets_created", foreign_keys=[created_by]
    )
    motor_carrier: Mapped["MotorCarrier"] = relationship(  # noqa: F821
        back_populates="tickets"
    )
    audit_flags: Mapped[list["QCAuditFlag"]] = relationship(  # noqa: F821
        back_populates="ticket", cascade="all, delete-orphan"
    )
    trailer: Mapped["Trailer | None"] = relationship()  # noqa: F821
    audit_logs: Mapped[list["AuditLog"]] = relationship(  # noqa: F821
        back_populates="ticket", cascade="all, delete-orphan"
    )
