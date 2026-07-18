import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Trailer(Base):
    __tablename__ = "trailers"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    trailer_number: Mapped[str] = mapped_column(
        String(100), unique=True, nullable=False, index=True
    )
    last_pti_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_lot_trailer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # R25: persistent papers (inspection/registration) reused across pickups
    documents: Mapped[list["TrailerDocument"]] = relationship(  # noqa: F821
        back_populates="trailer", cascade="all, delete-orphan"
    )
