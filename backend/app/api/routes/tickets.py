import uuid
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.models import (
    AuditEvent,
    AuditLog,
    ErrorCategory,
    FlagMedia,
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
)
from app.services.activity import record_event
from app.services.scoring import apply_approval_bonus, apply_flag_penalty
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
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
):
    # R2: PTI no longer blocks creation — the ticket may sit in AWAITING_DRIVER
    # unchecked. LOT trailers are resolved and persisted for the later gate.
    trailer = resolve_lot_trailer(db, payload)

    ticket = PickupTicket(
        created_by=current_user.id,
        trailer_id=trailer.id if trailer else None,
        **payload.model_dump(exclude={"trailer_number", "last_pti_date_override"}),
    )

    # Start the Carryover timer the moment a scale is needed but not yet received.
    if ticket.needs_scale and not ticket.scale_ticket_received:
        ticket.scale_requested_at = datetime.now(timezone.utc)

    db.add(ticket)
    db.flush()  # assign ticket.id and load relations for the readiness check
    ticket.state = (
        TicketState.PENDING_QC if is_ready_for_qc(ticket) else TicketState.AWAITING_DRIVER
    )
    record_event(db, ticket, current_user, AuditEvent.TICKET_CREATED)

    db.commit()
    return _get_ticket_or_404(db, ticket.id)


@router.patch("/api/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(
    ticket_id: uuid.UUID,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
):
    ticket = _get_ticket_or_404(db, ticket_id)

    if ticket.state == TicketState.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="APPROVED is a terminal state — this ticket can no longer be edited.",
        )

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(ticket, field, value)

    # If a scale becomes required and no timer is running, start one.
    if ticket.needs_scale and not ticket.scale_ticket_received and ticket.scale_requested_at is None:
        ticket.scale_requested_at = datetime.now(timezone.utc)

    # AWAITING_DRIVER/DRAFT + all required fields complete (incl. the PTI gate)
    # -> PENDING_QC. FLAGGED tickets stay FLAGGED until the explicit /resolve.
    if ticket.state in (TicketState.DRAFT, TicketState.AWAITING_DRIVER) and is_ready_for_qc(
        ticket
    ):
        ticket.state = TicketState.PENDING_QC
        record_event(db, ticket, current_user, AuditEvent.TICKET_SENT_TO_QC)

    db.commit()
    db.refresh(ticket)
    return ticket


@router.post("/api/tickets/{ticket_id}/resolve", response_model=TicketOut)
def resolve_ticket(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
):
    """Employee marks a FLAGGED ticket as fixed -> RESOLVED, back to the QC queue."""
    ticket = _get_ticket_or_404(db, ticket_id)
    if ticket.state != TicketState.FLAGGED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only FLAGGED tickets can be resolved (current: {ticket.state.value}).",
        )
    ticket.state = TicketState.RESOLVED
    record_event(db, ticket, current_user, AuditEvent.TICKET_RESOLVED)
    db.commit()
    db.refresh(ticket)
    return ticket


@router.get("/api/tickets/flagged", response_model=list[TicketOut])
def get_flagged(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
):
    """FLAGGED tickets bounced back to the employee dashboard."""
    return (
        db.scalars(
            _ticket_query.where(PickupTicket.state == TicketState.FLAGGED).order_by(
                PickupTicket.updated_at.asc()
            )
        )
        .unique()
        .all()
    )


@router.get("/api/tickets/carryover", response_model=list[TicketOut])
def get_carryover(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
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
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
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
