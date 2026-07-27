import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TrailerIssue(Base):
    """R44: a QC-reported problem with the physical trailer (damage,
    mechanical issue, etc.) that is NOT the employee's fault — the pickup
    can still be approved normally, this is tracked entirely separately
    from the flag/scoring system so it never touches the employee's score.

    Broadcast to every employee (a reminder toast every couple hours until
    resolved) since any of them might be the next one to encounter the same
    physical trailer. ticket_id is nullable and DETACHED (not cascaded) on
    ticket deletion, matching audit_logs/live_activity_feed — the issue is
    about the trailer, not the ticket, so it must outlive the ticket."""

    __tablename__ = "trailer_issues"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("pickup_tickets.id"), nullable=True, index=True
    )
    trailer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("trailers.id"), nullable=True, index=True
    )
    # Snapshots — readable even after the ticket is deleted/detached
    truck_number: Mapped[str] = mapped_column(String(100), nullable=False)
    trailer_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    mc_name: Mapped[str] = mapped_column(String(200), nullable=False)

    description: Mapped[str] = mapped_column(Text, nullable=False)
    reported_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    is_resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    reporter: Mapped["User"] = relationship(foreign_keys=[reported_by])  # noqa: F821
    resolver: Mapped["User | None"] = relationship(foreign_keys=[resolved_by])  # noqa: F821
