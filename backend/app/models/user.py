import uuid

from sqlalchemy import Boolean, Enum, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import UserRole


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    performance_score: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    tickets_created: Mapped[list["PickupTicket"]] = relationship(  # noqa: F821
        back_populates="creator", foreign_keys="PickupTicket.created_by"
    )
    flags_raised: Mapped[list["QCAuditFlag"]] = relationship(  # noqa: F821
        back_populates="flagger", foreign_keys="QCAuditFlag.flagged_by"
    )
