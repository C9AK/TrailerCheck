"""R44: non-punitive trailer issue tracker.

QC sometimes finds a real problem with the physical trailer (damage, a
mechanical fault, etc.) where the employee did everything right on their
end — flagging them would penalize a mistake that isn't theirs, and the
pickup should still be approved normally. This lets QC record the issue
separately so it survives independent of the ticket's own lifecycle,
broadcasts it to the whole team (anyone might meet the same trailer next),
and reminds them periodically until someone marks it resolved.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.models import PickupTicket, TrailerIssue, User, UserRole
from app.schemas.trailer_issue import TrailerIssueCreate, TrailerIssueOut

router = APIRouter(tags=["trailer-issues"])

_issue_query = select(TrailerIssue).options(
    joinedload(TrailerIssue.reporter), joinedload(TrailerIssue.resolver)
)


@router.post(
    "/api/tickets/{ticket_id}/trailer-issue",
    response_model=TrailerIssueOut,
    status_code=status.HTTP_201_CREATED,
)
def report_trailer_issue(
    ticket_id: uuid.UUID,
    payload: TrailerIssueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.qc, UserRole.manager)),
):
    """Available regardless of who created the ticket — unlike Flag/Approve,
    this isn't an audit verdict on the employee, so the "own pickup"
    conflict-of-interest rule doesn't apply here."""
    ticket = db.scalar(
        select(PickupTicket)
        .options(joinedload(PickupTicket.motor_carrier), joinedload(PickupTicket.trailer))
        .where(PickupTicket.id == ticket_id)
    )
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")

    issue = TrailerIssue(
        ticket_id=ticket.id,
        trailer_id=ticket.trailer_id,
        truck_number=ticket.truck_number,
        trailer_number=ticket.trailer.trailer_number if ticket.trailer else None,
        mc_name=ticket.motor_carrier.name,
        description=payload.description.strip(),
        reported_by=current_user.id,
    )
    db.add(issue)
    db.commit()
    return db.scalar(_issue_query.where(TrailerIssue.id == issue.id))


@router.get("/api/trailer-issues", response_model=list[TrailerIssueOut])
def list_trailer_issues(
    include_resolved: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The team-wide board — visible to every role, matching the shift-notes
    global inbox precedent. Open issues only by default."""
    q = _issue_query
    if not include_resolved:
        q = q.where(TrailerIssue.is_resolved.is_(False))
    return db.scalars(q.order_by(TrailerIssue.created_at.desc())).unique().all()


@router.post("/api/trailer-issues/{issue_id}/resolve", response_model=TrailerIssueOut)
def resolve_trailer_issue(
    issue_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """Anyone on the team can resolve — matching shift notes ("anyone on
    shift can resolve"). Stops the reminder and drops it off the board."""
    issue = db.scalar(_issue_query.where(TrailerIssue.id == issue_id))
    if issue is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Issue not found")
    if issue.is_resolved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This issue is already resolved."
        )
    issue.is_resolved = True
    issue.resolved_by = current_user.id
    issue.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(issue)
    return issue
