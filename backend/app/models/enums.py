import enum


class UserRole(str, enum.Enum):
    employee = "employee"
    qc = "qc"
    manager = "manager"


class TicketState(str, enum.Enum):
    DRAFT = "DRAFT"
    # R17 "Still Sending": a deliberately parked pickup the dispatcher will
    # resume — excluded from carryover and the QC queue until submitted.
    DRAFT_IN_PROGRESS = "DRAFT_IN_PROGRESS"
    AWAITING_DRIVER = "AWAITING_DRIVER"
    PENDING_QC = "PENDING_QC"
    FLAGGED = "FLAGGED"
    RESOLVED = "RESOLVED"
    APPROVED = "APPROVED"


class TrailerCondition(str, enum.Enum):
    Good = "Good"
    Fair = "Fair"
    Damaged = "Damaged"


class ErrorCategory(str, enum.Enum):
    # legacy categories (kept so existing audit rows stay valid)
    Missing_BOL = "Missing_BOL"
    Incorrect_Weight = "Incorrect_Weight"
    Missed_PTI = "Missed_PTI"
    # strict categories (Module C revision)
    Missing_Inspection = "Missing_Inspection"
    Missing_Sticker = "Missing_Sticker"
    Missing_Registration = "Missing_Registration"
    Missed_KPRA_Reminder = "Missed_KPRA_Reminder"
    PTI_Video_Missing_Light_Test = "PTI_Video_Missing_Light_Test"
    Didnt_Text_In_Group = "Didnt_Text_In_Group"  # requires severity 1-10
    Other = "Other"


class MediaType(str, enum.Enum):
    image = "image"
    video = "video"


class TrailerDocType(str, enum.Enum):
    # R25: persistent trailer papers — re-usable across pickups
    inspection = "inspection"
    registration = "registration"


class NoteStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    RESOLVED = "RESOLVED"


class AuditEvent(str, enum.Enum):
    TICKET_CREATED = "TICKET_CREATED"
    TICKET_SENT_TO_QC = "TICKET_SENT_TO_QC"  # carryover ticket completed via PATCH
    TICKET_FLAGGED = "TICKET_FLAGGED"
    TICKET_RESOLVED = "TICKET_RESOLVED"
    TICKET_APPROVED = "TICKET_APPROVED"
    TICKET_DELETED = "TICKET_DELETED"
    TICKET_UNRESOLVABLE = "TICKET_UNRESOLVABLE"
    # R23: trailer dropped — dispatch can no longer process the pickup
    TICKET_DROPPED = "TICKET_DROPPED"
