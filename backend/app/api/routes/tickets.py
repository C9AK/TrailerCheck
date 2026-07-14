import uuid
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func as sa_func
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.models import (
    AuditEvent,
    AuditLog,
    ErrorCategory,
    FlagMedia,
    LiveActivityFeed,
    MotorCarrier,
    PickupTicket,
    QCAuditFlag,
    TicketState,
    User,
    UserRole,
)
from app.schemas.ticket import (
    EmployeeStats,
    FlagRequest,
    QCHistoryOut,
    TicketCreate,
    TicketOut,
    TicketUpdate,
    UnresolvableRequest,
)
from app.services.activity import record_event
from app.services.pti import compute_pti_verified
from app.services.scoring import apply_approval_bonus, apply_flag_penalty, apply_teamwork_bonus
from app.services.ticket_lifecycle import is_ready_for_qc, resolve_lot_trailer


router = APIRouter(tags=["tickets"])

_ticket_query = select(PickupTicket).options(
    joinedload(PickupTicket.creator),
    joinedload(PickupTicket.motor_carrier),
    joinedload(PickupTicket.trailer),
    selectinload(PickupTicket.audit_flags).selectinload(QCAuditFlag.media),
)


def _get_ticket_or_404(db: Session, ticket_id: uuid.UUID) -> PickupTicket:
    ticket = db.scalar(_ticket_query.where(PickupTicket.id == ticket_id))
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


@router.post("/api/tickets", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
def create_ticket(
    payload: TicketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    # R2: PTI no longer blocks creation — the ticket may sit in AWAITING_DRIVER
    # unchecked. LOT trailers are resolved and persisted for the later gate.
    trailer = resolve_lot_trailer(db, payload)

    ticket = PickupTicket(
        created_by=current_user.id,
        trailer_id=trailer.id if trailer else None,
        **payload.model_dump(exclude={"trailer_number", "last_pti_date_override"}),
    )

    # R8: structured checklist drives the derived pti_verified gate
    # (R12: chassis-only items count only when is_chassis)
    if payload.pti_checklist is not None:
        ticket.pti_verified = compute_pti_verified(payload.pti_checklist, ticket.is_chassis)
    # R15: CRVR in the weight text no longer forces the scale queue — the
    # dispatcher decides via the Needs Scale checkbox alone.

    # Start the Carryover timer the moment a scale is needed but not yet received.
    if ticket.needs_scale and not ticket.scale_ticket_received:
        ticket.scale_requested_at = datetime.now(timezone.utc)

    db.add(ticket)
    db.flush()  # assign ticket.id and load relations for the readiness check
    ticket.state = (
        TicketState.PENDING_QC if is_ready_for_qc(ticket) else TicketState.AWAITING_DRIVER
    )
    if ticket.state == TicketState.PENDING_QC:
        ticket.submitted_to_qc_at = datetime.now(timezone.utc)
    record_event(db, ticket, current_user, AuditEvent.TICKET_CREATED)

    db.commit()
    return _get_ticket_or_404(db, ticket.id)


@router.patch("/api/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(
    ticket_id: uuid.UUID,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    ticket = _get_ticket_or_404(db, ticket_id)

    # R7 RBAC: employees may only edit their OWN tickets; managers edit any
    # ticket in any state (including APPROVED). R14: QC creates pickups under
    # the same ownership rules as employees.
    # R8 exception: urgent-flagged tickets are open for team triage — any
    # employee may fix them.
    if (
        current_user.role != UserRole.manager
        and ticket.created_by != current_user.id
        and not (ticket.state == TicketState.FLAGGED and ticket.is_urgent_flag)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit tickets you created.",
        )
    if ticket.state == TicketState.APPROVED and current_user.role != UserRole.manager:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="APPROVED is a terminal state — only a manager can edit this ticket.",
        )

    updates = payload.model_dump(exclude_unset=True)
    # R14: the MC is editable after creation — validate it exists first so the
    # FK never blows up mid-commit.
    if "mc_id" in updates and updates["mc_id"] is not None:
        if db.get(MotorCarrier, updates["mc_id"]) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Motor carrier not found."
            )
    elif "mc_id" in updates:
        updates.pop("mc_id")  # never null out the required MC
    for field, value in updates.items():
        setattr(ticket, field, value)

    # Re-derive the PTI gate when the checklist OR the chassis toggle changes
    if "pti_checklist" in updates or "is_chassis" in updates:
        ticket.pti_verified = compute_pti_verified(
            ticket.pti_checklist or {}, ticket.is_chassis
        )

    # If a scale becomes required and no timer is running, start one.
    if ticket.needs_scale and not ticket.scale_ticket_received and ticket.scale_requested_at is None:
        ticket.scale_requested_at = datetime.now(timezone.utc)

    # AWAITING_DRIVER/DRAFT + all required fields complete (incl. the PTI gate)
    # -> PENDING_QC. FLAGGED tickets stay FLAGGED until the explicit /resolve.
    if ticket.state in (TicketState.DRAFT, TicketState.AWAITING_DRIVER) and is_ready_for_qc(
        ticket
    ):
        ticket.state = TicketState.PENDING_QC
        if ticket.submitted_to_qc_at is None:  # first submission only
            ticket.submitted_to_qc_at = datetime.now(timezone.utc)
        record_event(db, ticket, current_user, AuditEvent.TICKET_SENT_TO_QC)

    db.commit()
    db.refresh(ticket)
    return ticket


@router.delete("/api/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """R7 RBAC: managers delete any pickup; employees/QC only their own.
    The deletion is recorded in both the audit log and the immutable feed;
    existing audit-log AND feed rows are detached (ticket_id -> NULL), never
    destroyed — QC flags + their media cascade away with the ticket."""
    ticket = _get_ticket_or_404(db, ticket_id)
    if (
        current_user.role != UserRole.manager
        and ticket.created_by != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete tickets you created.",
        )

    record_event(db, ticket, current_user, AuditEvent.TICKET_DELETED)
    db.flush()
    # Detach ALL audit-log + live-feed rows (incl. the deletion event just
    # written) before removing the ticket so history survives. Without this,
    # Postgres rejects the delete with a foreign-key IntegrityError.
    db.execute(
        update(AuditLog).where(AuditLog.ticket_id == ticket.id).values(ticket_id=None)
    )
    db.execute(
        update(LiveActivityFeed)
        .where(LiveActivityFeed.ticket_id == ticket.id)
        .values(ticket_id=None)
    )
    db.expire(ticket, ["audit_logs"])
    db.delete(ticket)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/tickets/{ticket_id}/resolve", response_model=TicketOut)
def resolve_ticket(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """Employee marks a FLAGGED ticket as fixed -> RESOLVED, back to the QC queue.
    R8: standard flags may only be resolved by their creator (Mistake Privacy);
    urgent flags by ANY employee, who earns a teamwork bonus if not the creator.
    R14: QC users creating pickups follow the same rules as employees."""
    ticket = _get_ticket_or_404(db, ticket_id)
    if ticket.state != TicketState.FLAGGED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only FLAGGED tickets can be resolved (current: {ticket.state.value}).",
        )
    if (
        current_user.role != UserRole.manager
        and ticket.created_by != current_user.id
        and not ticket.is_urgent_flag
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the ticket's creator can resolve a standard flag.",
        )

    ticket.state = TicketState.RESOLVED
    ticket.resolved_by = current_user.id
    # Shared-credit engine: the fixer of someone else's urgent flag earns a
    # teamwork bonus now; the creator still gets baseline credit at approval.
    if ticket.is_urgent_flag and current_user.id != ticket.created_by:
        apply_teamwork_bonus(current_user)
    record_event(db, ticket, current_user, AuditEvent.TICKET_RESOLVED)
    db.commit()
    db.refresh(ticket)
    return ticket


@router.post("/api/tickets/{ticket_id}/unresolvable", response_model=TicketOut)
def mark_unresolvable(
    ticket_id: uuid.UUID,
    payload: UnresolvableRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """R11 escape hatch: a FLAGGED ticket the employee cannot physically fix is
    escalated back to QC (-> PENDING_QC) with a mandatory reason, clearing it
    from the employee's active board. Same permission rules as resolve."""
    ticket = _get_ticket_or_404(db, ticket_id)
    if ticket.state != TicketState.FLAGGED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only FLAGGED tickets can be marked unresolvable (current: {ticket.state.value}).",
        )
    if (
        current_user.role != UserRole.manager
        and ticket.created_by != current_user.id
        and not ticket.is_urgent_flag
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the ticket's creator can mark a standard flag unresolvable.",
        )

    ticket.is_unresolvable = True
    ticket.unresolvable_reason = payload.reason.strip()
    ticket.state = TicketState.PENDING_QC
    record_event(db, ticket, current_user, AuditEvent.TICKET_UNRESOLVABLE)
    db.commit()
    db.refresh(ticket)
    return ticket


@router.get("/api/tickets/flagged", response_model=list[TicketOut])
def get_flagged(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """Action Required queue. R8 Mistake Privacy: employees (and QC acting as
    creators, R14) see their OWN flagged tickets plus any URGENT flags (global
    triage); managers see all."""
    q = _ticket_query.where(PickupTicket.state == TicketState.FLAGGED)
    if current_user.role != UserRole.manager:
        q = q.where(
            or_(
                PickupTicket.created_by == current_user.id,
                PickupTicket.is_urgent_flag.is_(True),
            )
        )
    return (
        db.scalars(
            q.order_by(
                PickupTicket.is_urgent_flag.desc(), PickupTicket.updated_at.asc()
            )
        )
        .unique()
        .all()
    )


@router.get("/api/tickets/carryover", response_model=list[TicketOut])
def get_carryover(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """Employee active board. Tickets remain visible and editable through
    PENDING_QC/RESOLVED — they only leave this board once APPROVED
    (FLAGGED tickets are served by /api/tickets/flagged for their own section)."""
    return (
        db.scalars(
            _ticket_query.where(
                PickupTicket.state.in_(
                    [TicketState.AWAITING_DRIVER, TicketState.PENDING_QC, TicketState.RESOLVED]
                )
            ).order_by(PickupTicket.scale_requested_at.asc().nulls_last())
        )
        .unique()
        .all()
    )


@router.get("/api/tickets/all", response_model=list[TicketOut])
def get_all_tickets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Global Sheet: every ticket in the system, visible to ALL roles."""
    return (
        db.scalars(
            _ticket_query.order_by(PickupTicket.created_at.desc()).limit(500)
        )
        .unique()
        .all()
    )


@router.get("/api/tickets/qc", response_model=list[TicketOut])
def get_qc_queue(
    include_awaiting: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.qc, UserRole.manager)),
):
    states = [TicketState.PENDING_QC, TicketState.RESOLVED]
    if include_awaiting:
        states.append(TicketState.AWAITING_DRIVER)
    return (
        db.scalars(
            _ticket_query.where(PickupTicket.state.in_(states)).order_by(
                PickupTicket.updated_at.asc()
            )
        )
        .unique()
        .all()
    )


@router.get("/api/tickets/my-history", response_model=list[TicketOut])
def get_my_history(
    on_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """EVERY ticket created by the logged-in user, in any state, newest first."""
    q = _ticket_query.where(PickupTicket.created_by == current_user.id)
    if on_date:
        q = q.where(
            PickupTicket.created_at >= datetime.combine(on_date, time.min, timezone.utc),
            PickupTicket.created_at <= datetime.combine(on_date, time.max, timezone.utc),
        )
    return db.scalars(q.order_by(PickupTicket.created_at.desc())).unique().all()


@router.get("/api/tickets/qc-history", response_model=list[QCHistoryOut])
def get_qc_history(
    outcome: str = "approved",
    on_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.qc, UserRole.manager)),
):
    """Tickets processed by the logged-in QC user: approved or flagged by them,
    dated by when the action happened (not when the ticket was created)."""
    if outcome not in ("approved", "flagged"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="outcome must be 'approved' or 'flagged'.",
        )
    event = (
        AuditEvent.TICKET_APPROVED if outcome == "approved" else AuditEvent.TICKET_FLAGGED
    )
    q = (
        select(PickupTicket, AuditLog.created_at)
        .join(AuditLog, AuditLog.ticket_id == PickupTicket.id)
        .options(
            joinedload(PickupTicket.creator),
            joinedload(PickupTicket.motor_carrier),
            joinedload(PickupTicket.trailer),
            selectinload(PickupTicket.audit_flags).selectinload(QCAuditFlag.media),
        )
        .where(AuditLog.actor_id == current_user.id, AuditLog.event == event)
    )
    if on_date:
        q = q.where(
            AuditLog.created_at >= datetime.combine(on_date, time.min, timezone.utc),
            AuditLog.created_at <= datetime.combine(on_date, time.max, timezone.utc),
        )
    rows = db.execute(q.order_by(AuditLog.created_at.desc())).unique().all()
    return [QCHistoryOut(processed_at=processed_at, ticket=ticket) for ticket, processed_at in rows]


@router.get("/api/tickets/archive", response_model=list[TicketOut])
def get_archive(
    start_date: date | None = None,
    end_date: date | None = None,
    state: TicketState | None = None,
    created_by: uuid.UUID | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.manager)),
):
    """Manager archive: ALL tickets, filterable by date range / state / employee."""
    q = _ticket_query
    if start_date:
        q = q.where(
            PickupTicket.created_at >= datetime.combine(start_date, time.min, timezone.utc)
        )
    if end_date:
        q = q.where(
            PickupTicket.created_at <= datetime.combine(end_date, time.max, timezone.utc)
        )
    if state:
        q = q.where(PickupTicket.state == state)
    if created_by:
        q = q.where(PickupTicket.created_by == created_by)
    q = q.order_by(PickupTicket.created_at.desc()).limit(min(limit, 200)).offset(offset)
    return db.scalars(q).unique().all()


@router.get("/api/stats/employees", response_model=list[EmployeeStats])
def get_employee_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.manager)),
):
    """Per-employee completed pickups (= APPROVED, by approval timestamp)."""
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)

    def counts(since: datetime | None) -> dict[uuid.UUID, int]:
        q = (
            select(PickupTicket.created_by, sa_func.count(AuditLog.id))
            .select_from(AuditLog)
            .join(PickupTicket, AuditLog.ticket_id == PickupTicket.id)
            .where(AuditLog.event == AuditEvent.TICKET_APPROVED)
            .group_by(PickupTicket.created_by)
        )
        if since is not None:
            q = q.where(AuditLog.created_at >= since)
        return dict(db.execute(q).all())

    daily = counts(day_start)
    monthly = counts(month_start)
    all_time = counts(None)

    employees = db.scalars(
        select(User).where(User.role == UserRole.employee).order_by(User.username)
    ).all()
    return [
        EmployeeStats(
            user_id=u.id,
            username=u.username,
            performance_score=u.performance_score,
            completed_daily=daily.get(u.id, 0),
            completed_monthly=monthly.get(u.id, 0),
            completed_all_time=all_time.get(u.id, 0),
        )
        for u in employees
    ]


@router.post("/api/tickets/{ticket_id}/approve", response_model=TicketOut)
def approve_ticket(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.qc, UserRole.manager)),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    # R14 conflict of interest: QC may create pickups, but NEVER audit their
    # own — another QC or a manager must review them.
    if current_user.role == UserRole.qc and ticket.created_by == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conflict of interest — you cannot approve a pickup you created.",
        )
    # AWAITING_DRIVER allowed: QC may consciously approve early.
    if ticket.state not in (
        TicketState.PENDING_QC,
        TicketState.RESOLVED,
        TicketState.AWAITING_DRIVER,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ticket cannot be approved from state {ticket.state.value}.",
        )
    ticket.state = TicketState.APPROVED
    apply_approval_bonus(ticket.creator)
    record_event(db, ticket, current_user, AuditEvent.TICKET_APPROVED)
    db.commit()
    db.refresh(ticket)
    return ticket


@router.post("/api/tickets/{ticket_id}/flag", response_model=TicketOut)
def flag_ticket(
    ticket_id: uuid.UUID,
    payload: FlagRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.qc, UserRole.manager)),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    # R14 conflict of interest: QC never audits their own pickup.
    if current_user.role == UserRole.qc and ticket.created_by == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conflict of interest — you cannot flag a pickup you created.",
        )
    if ticket.state not in (
        TicketState.PENDING_QC,
        TicketState.RESOLVED,
        TicketState.AWAITING_DRIVER,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ticket cannot be flagged from state {ticket.state.value}.",
        )
    ticket.state = TicketState.FLAGGED
    ticket.is_urgent_flag = payload.is_urgent
    ticket.resolved_by = None  # new flag cycle — nobody has fixed it yet
    # QC re-flagging an escalated exception rejects it back into the normal
    # fix loop (the reason and feed history remain on record).
    ticket.is_unresolvable = False
    first_flag: QCAuditFlag | None = None
    for category in payload.error_categories:
        severity = (
            payload.severity if category == ErrorCategory.Didnt_Text_In_Group else None
        )
        flag = QCAuditFlag(
            ticket_id=ticket.id,
            flagged_by=current_user.id,
            error_category=category,
            severity=severity,
            notes=payload.notes,
        )
        db.add(flag)
        if first_flag is None:
            first_flag = flag
        apply_flag_penalty(ticket.creator, category, severity)

    # Proof media attaches to the flag action (stored on its first row).
    if payload.media and first_flag is not None:
        db.flush()
        for item in payload.media:
            db.add(
                FlagMedia(
                    flag_id=first_flag.id,
                    media_url=item.url,
                    media_type=item.media_type,
                    uploaded_by=current_user.id,
                )
            )

    record_event(db, ticket, current_user, AuditEvent.TICKET_FLAGGED)
    db.commit()
    return _get_ticket_or_404(db, ticket.id)


# NOTE: keep this LAST — the literal /api/tickets/* GET routes above must
# match before this catch-all path parameter.
@router.get("/api/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Single-ticket fetch (powers the full-form edit prefill)."""
    return _get_ticket_or_404(db, ticket_id)
