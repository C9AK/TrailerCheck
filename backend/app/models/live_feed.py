import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import AuditEvent


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LiveActivityFeed(Base):
    """Immutable, denormalized activity record for the manager live feed.

    Usernames, truck number, MC name and the rendered message are snapshotted
    at write time so the record stays intact for dispute resolution even if
    the underlying ticket or users change later. Insert-only — the API exposes
    no update or delete for this table.
    """

    __tablename__ = "live_activity_feed"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("pickup_tickets.id"), nullable=False, index=True
    )
    event: Mapped[AuditEvent] = mapped_column(
        Enum(AuditEvent, name="audit_event"), nullable=False, index=True
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    # Snapshots (never joined, never rewritten)
    actor_username: Mapped[str] = mapped_column(String(100), nullable=False)
    employee_username: Mapped[str] = mapped_column(String(100), nullable=False)
    truck_number: Mapped[str] = mapped_column(String(100), nullable=False)
    mc_name: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )
