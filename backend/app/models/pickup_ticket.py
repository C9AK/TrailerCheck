import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, String, Text, Uuid, func
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
    bol_present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # R17: extra checkout confirmations (informational — not QC gates)
    eld_mentioned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    checklist_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # R7: free-text — scale tickets sometimes carry annotations, not just numbers
    weight: Mapped[str | None] = mapped_column(String(100), nullable=True)
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
    # R9: first transition to PENDING_QC — powers the Efficiency component of
    # the leaderboard composite score (avg created_at -> submitted_to_qc_at).
    submitted_to_qc_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # R21: dispatcher "Followed up" action — the Carryover waiting timer and
    # 2h/4h overdue signals restart from this timestamp when it is newer than
    # scale_requested_at (which keeps the original request time on record).
    last_followed_up_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # PTI verification - strictly checkboxes, no file uploads.
    # R8: structured checklist (JSON dict of item -> bool) is the source of
    # truth; pti_verified is DERIVED server-side from it (kept for the QC gate,
    # LOT window logic, and display).
    pti_checklist: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pti_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # R12: chassis tickets require the Chassis PTI section (locks + zip ties)
    is_chassis: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # R8 triage: urgent flags bypass Mistake Privacy (visible/fixable by all
    # employees); resolved_by records exactly who fixed the flag.
    is_urgent_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )

    # R23: the truck dropped its trailer — dispatch can no longer process the
    # pickup. Ends the lifecycle: excluded from every active board and queue;
    # the ticket keeps its last state for the historical record.
    is_dropped: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # R25: UGL does not haul hazmat — while True on an active ticket, the
    # Samsara movement monitor watches the truck and blasts a global alert
    # the moment it moves. Toggleable off if hazmat is removed from the load.
    is_hazmat: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # R22: set the FIRST time this ticket's consolidated auto shift-note is
    # persisted. Once true, the system never regenerates the note — user
    # deletions stay deleted and user edits are never overwritten.
    auto_note_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # R11 escape hatch: flagged tickets the employee physically cannot fix are
    # escalated back to QC with a mandatory written reason; the exception data
    # is permanent, even after a Force Approve.
    is_unresolvable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    unresolvable_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    # No delete cascade: audit logs must SURVIVE ticket deletion (ticket_id is
    # detached to NULL instead) so the deletion itself stays on record.
    audit_logs: Mapped[list["AuditLog"]] = relationship(  # noqa: F821
        back_populates="ticket"
    )
