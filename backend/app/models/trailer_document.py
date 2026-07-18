import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import TrailerDocType


class TrailerDocument(Base):
    """R25: a trailer's Inspection/Registration paper, persisted against the
    trailer itself (any pickup, not just LOT) so a returning trailer never
    needs its papers re-uploaded. One CURRENT document per type per trailer —
    a new upload replaces the old row's file reference."""

    __tablename__ = "trailer_documents"
    __table_args__ = (
        UniqueConstraint("trailer_id", "doc_type", name="uq_trailer_doc_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    trailer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("trailers.id"), nullable=False, index=True
    )
    doc_type: Mapped[TrailerDocType] = mapped_column(
        Enum(TrailerDocType, name="trailer_doc_type"), nullable=False
    )
    media_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
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

    trailer: Mapped["Trailer"] = relationship(back_populates="documents")  # noqa: F821
