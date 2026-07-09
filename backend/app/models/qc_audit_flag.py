import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import ErrorCategory


class QCAuditFlag(Base):
    __tablename__ = "qc_audit_flags"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("pickup_tickets.id"), nullable=False, index=True
    )
    flagged_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    error_category: Mapped[ErrorCategory] = mapped_column(
        Enum(ErrorCategory, name="error_category"), nullable=False
    )
    # 1-10 gauge; only set for Didnt_Text_In_Group (enforced at the API layer)
    severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    ticket: Mapped["PickupTicket"] = relationship(  # noqa: F821
        back_populates="audit_flags"
    )
    flagger: Mapped["User"] = relationship(  # noqa: F821
        back_populates="flags_raised", foreign_keys=[flagged_by]
    )
    media: Mapped[list["FlagMedia"]] = relationship(  # noqa: F821
        back_populates="flag", cascade="all, delete-orphan"
    )
