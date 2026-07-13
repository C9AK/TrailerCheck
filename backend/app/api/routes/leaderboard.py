"""R9/R10 Leaderboard — Weighted Composite Score for active employees AND QC.

Employees:  volume = tickets created; accuracy = share never flagged;
            efficiency = avg created_at -> submitted_to_qc_at.
QC:         volume = tickets processed (approve + flag actions);
            efficiency = avg QC turnaround (submitted_to_qc_at -> verdict);
            accuracy fixed at 100 (no counter-signal exists yet).
Both feed the same composite formula, so the volume multiplier applies
equally.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import AuditEvent, AuditLog, PickupTicket, QCAuditFlag, User, UserRole
from app.services.scoring import calculate_qc_score

router = APIRouter(tags=["leaderboard"])


class LeaderboardEntry(BaseModel):
    rank: int
    id: uuid.UUID
    name: str
    role: UserRole
    score: float
    volume: int
    accuracy: float
    efficiency: float
    avg_time_mins: float | None


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _avg(durations: list[float]) -> float | None:
    return round(sum(durations) / len(durations), 1) if durations else None


@router.get("/api/leaderboard", response_model=list[LeaderboardEntry])
def get_leaderboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    users = db.scalars(
        select(User).where(
            User.role.in_([UserRole.employee, UserRole.qc]), User.is_active.is_(True)
        )
    ).all()

    ticket_rows = db.execute(
        select(
            PickupTicket.id,
            PickupTicket.created_by,
            PickupTicket.created_at,
            PickupTicket.submitted_to_qc_at,
        )
    ).all()
    flagged_ticket_ids = set(db.scalars(select(QCAuditFlag.ticket_id).distinct()).all())
    submitted_by_ticket = {row[0]: row[3] for row in ticket_rows}

    # Employee stats: created tickets
    emp_stats: dict[uuid.UUID, dict] = {}
    for ticket_id, created_by, created_at, submitted_at in ticket_rows:
        s = emp_stats.setdefault(created_by, {"total": 0, "flagged": 0, "durations": []})
        s["total"] += 1
        if ticket_id in flagged_ticket_ids:
            s["flagged"] += 1
        if submitted_at is not None:
            delta = _as_utc(submitted_at) - _as_utc(created_at)
            s["durations"].append(max(0.0, delta.total_seconds() / 60.0))

    # QC stats: approve/flag verdicts + turnaround from submission
    qc_stats: dict[uuid.UUID, dict] = {}
    verdicts = db.execute(
        select(AuditLog.actor_id, AuditLog.created_at, AuditLog.ticket_id).where(
            AuditLog.event.in_([AuditEvent.TICKET_APPROVED, AuditEvent.TICKET_FLAGGED])
        )
    ).all()
    for actor_id, acted_at, ticket_id in verdicts:
        s = qc_stats.setdefault(actor_id, {"total": 0, "durations": []})
        s["total"] += 1
        submitted_at = submitted_by_ticket.get(ticket_id)
        if submitted_at is not None:
            delta = _as_utc(acted_at) - _as_utc(submitted_at)
            s["durations"].append(max(0.0, delta.total_seconds() / 60.0))

    scored = []
    for user in users:
        if user.role == UserRole.employee:
            s = emp_stats.get(user.id, {"total": 0, "flagged": 0, "durations": []})
            avg_time = _avg(s["durations"])
            result = calculate_qc_score(s["total"], s["flagged"], avg_time)
        else:  # qc — accuracy has no counter-signal yet, so flagged=0 (A=100)
            s = qc_stats.get(user.id, {"total": 0, "durations": []})
            avg_time = _avg(s["durations"])
            result = calculate_qc_score(s["total"], 0, avg_time)
        scored.append(
            {
                "id": user.id,
                "name": user.username,
                "role": user.role,
                "score": result["score"],
                "volume": s["total"],
                "accuracy": result["accuracy"],
                "efficiency": result["efficiency"],
                "avg_time_mins": avg_time,
            }
        )

    scored.sort(key=lambda e: (-e["score"], -e["volume"], e["name"]))
    return [LeaderboardEntry(rank=i + 1, **entry) for i, entry in enumerate(scored)]
