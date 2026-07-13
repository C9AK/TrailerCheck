"""Performance score adjustments."""

from app.models import ErrorCategory, User

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
