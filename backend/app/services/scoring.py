"""Performance score adjustments + the R9 Weighted Composite Score.

Composite model:
    Final = (Wa*A + We*E) * min(1, log10(N+1) / log10(T+1))
    A = accuracy 0-100 = (total - flagged_tickets) / total * 100  (clamped >= 0)
    E = 100 if avg time <= 15 min, else -10 per minute over        (clamped >= 0)
    N = total tickets processed; T = target volume (50)
The log multiplier solves the "1-ticket wonder": one perfect ticket scores
~17.6, and full weight is only reached at the target volume.
"""

import math

from app.models import ErrorCategory, User

ACCURACY_WEIGHT = 0.70
EFFICIENCY_WEIGHT = 0.30
TARGET_VOLUME = 50
TARGET_TIME_MINS = 15.0
EFFICIENCY_PENALTY_PER_MIN = 10.0


def calculate_qc_score(
    total_tickets: int,
    flagged_tickets: int,
    avg_time_mins: float | None,
    *,
    target_volume: int = TARGET_VOLUME,
    target_time_mins: float = TARGET_TIME_MINS,
) -> dict:
    """Returns {score, accuracy, efficiency, volume_multiplier}."""
    if total_tickets <= 0:
        return {"score": 0.0, "accuracy": 0.0, "efficiency": 100.0, "volume_multiplier": 0.0}

    accuracy = max(0.0, (total_tickets - flagged_tickets) / total_tickets * 100.0)

    if avg_time_mins is None:  # nothing submitted to QC yet
        efficiency = 100.0
    else:
        minutes_over = max(0.0, avg_time_mins - target_time_mins)
        efficiency = max(0.0, 100.0 - EFFICIENCY_PENALTY_PER_MIN * minutes_over)

    volume_multiplier = min(
        1.0, math.log10(total_tickets + 1) / math.log10(target_volume + 1)
    )
    score = (ACCURACY_WEIGHT * accuracy + EFFICIENCY_WEIGHT * efficiency) * volume_multiplier
    return {
        "score": round(score, 1),
        "accuracy": round(accuracy, 1),
        "efficiency": round(efficiency, 1),
        "volume_multiplier": round(volume_multiplier, 3),
    }

APPROVAL_POINTS = 10
# R8 shared-credit: bonus for an employee who resolves someone ELSE's urgent flag
TEAMWORK_BONUS = 5

# Severity-based deductions — placeholder values, adjust as the business decides.
# Didnt_Text_In_Group is scored by the QC's 1-10 severity gauge instead.
FLAG_PENALTIES: dict[ErrorCategory, int] = {
    ErrorCategory.Missed_PTI: 20,
    ErrorCategory.Missing_BOL: 15,
    ErrorCategory.Incorrect_Weight: 10,
    ErrorCategory.Missing_Inspection: 15,
    ErrorCategory.Missing_Sticker: 10,
    ErrorCategory.Missing_Registration: 15,
    ErrorCategory.Missed_KPRA_Reminder: 10,
    ErrorCategory.PTI_Video_Missing_Light_Test: 15,
    ErrorCategory.Other: 5,
}


def apply_approval_bonus(creator: User) -> None:
    creator.performance_score += APPROVAL_POINTS


def apply_teamwork_bonus(fixer: User) -> None:
    fixer.performance_score += TEAMWORK_BONUS


def apply_flag_penalty(creator: User, category: ErrorCategory, severity: int | None = None) -> None:
    if category == ErrorCategory.Didnt_Text_In_Group:
        penalty = severity if severity is not None else 5
    else:
        penalty = FLAG_PENALTIES.get(category, 5)
    creator.performance_score = max(0, creator.performance_score - penalty)
