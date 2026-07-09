import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import NoteStatus


class ShiftNote(Base):
    """Shift handover notes — auto-generated from carryover gaps or typed
    manually, published to a shared team inbox, resolved by the next shift."""

    __tablename__ = "shift_notes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Linked ticket context when auto-generated
    truck_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    mc_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_auto_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[NoteStatus] = mapped_column(
        Enum(NoteStatus, name="note_status"),
        nullable=False,
        default=NoteStatus.DRAFT,
        index=True,
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    creator: Mapped["User"] = relationship(foreign_keys=[created_by])  # noqa: F821
    resolver: Mapped["User | None"] = relationship(foreign_keys=[resolved_by])  # noqa: F821
