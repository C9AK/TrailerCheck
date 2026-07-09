import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import MediaType


class FlagMedia(Base):
    """Proof attachment on a QC flag: an uploaded file URL or a pasted URL."""

    __tablename__ = "flag_media"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    flag_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("qc_audit_flags.id"), nullable=False, index=True
    )
    media_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    media_type: Mapped[MediaType] = mapped_column(
        Enum(MediaType, name="media_type"), nullable=False
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    flag: Mapped["QCAuditFlag"] = relationship(  # noqa: F821
        back_populates="media"
    )
