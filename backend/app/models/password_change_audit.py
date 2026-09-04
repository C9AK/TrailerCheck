import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PasswordChangeAudit(Base):
    """R52: security visibility for the ADMIN account holder — every time
    someone OTHER than an account's own owner changes that account's
    password via the Admin page, a row is written here so the admin can see
    exactly who did it, to which account, and when.

    Deliberately separate from audit_logs/live_activity_feed: those are
    ticket-shaped (R14 made ticket_id nullable specifically so ticket
    history could survive deletion, but every other column there still
    assumes a ticket/truck/MC exists) and this concerns account security,
    not a ticket lifecycle event. A dedicated table — same precedent as
    TrailerIssue/ShiftNote — keeps the two concerns from being forced
    through a schema that doesn't fit either of them.

    Usernames are snapshotted (not just the FK) so the record reads
    correctly even if an account is later renamed; `target_user_id` and
    `changed_by` stay real foreign keys (not nullable/detached like the
    ticket tables) because DELETE /api/admin/users/{id} already refuses to
    hard-delete any user with recorded activity — this table's rows count
    toward that tally, so a referenced user is never actually deletable out
    from under this history in the first place.
    """

    __tablename__ = "password_change_audits"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    target_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    changed_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    target_username: Mapped[str] = mapped_column(String(100), nullable=False)
    changed_by_username: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
