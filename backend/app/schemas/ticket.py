import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import ErrorCategory, MediaType, TicketState, TrailerCondition
from app.schemas.motor_carrier import MCBrief
from app.schemas.user import UserBrief


class TicketCreate(BaseModel):
    mc_id: uuid.UUID
    truck_number: str = Field(min_length=1, max_length=100)

    # LOT trailer inputs; trailer_number resolves to a persisted trailer_id
    is_lot_trailer: bool = False
    trailer_number: str | None = None
    last_pti_date_override: datetime | None = None

    # Telematics (auto-filled client-side from the telemetry endpoint)
    driver_name: str | None = None
    truck_location: str | None = None
    truck_latitude: float | None = None
    truck_longitude: float | None = None
    truck_model: str | None = None
    fuel_percentage: float | None = None

    # Checklist
    registration_verified: bool = False
    inspection_paper_verified: bool = False
    sticker_verified: bool = False
    is_ca_fl_destination: bool = False
    bol_present: bool = False
    eld_mentioned: bool = False  # R17
    checklist_sent: bool = False  # R17
    weight: str | None = Field(default=None, max_length=100)  # R7: free text
    trailer_condition: TrailerCondition | None = None
    condition_notes: str | None = None
    needs_scale: bool = False
    scale_ticket_received: bool = False
    # R8: structured checklist is authoritative; pti_verified is derived from
    # it server-side when provided (kept as a legacy fallback otherwise).
    pti_checklist: dict[str, bool] | None = None
    pti_verified: bool = False
    is_chassis: bool = False
    # R17 "Still Sending": park the ticket as DRAFT_IN_PROGRESS instead of
    # entering the normal AWAITING/PENDING_QC lifecycle.
    still_sending: bool = False

    @field_validator("weight", mode="before")
    @classmethod
    def _weight_to_str(cls, v):
        return None if v is None else str(v)


class TicketUpdate(BaseModel):
    """PATCH payload for inline edits — every field optional; state is server-controlled."""

    # R14: the MC is correctable after creation (validated against the MC table)
    mc_id: uuid.UUID | None = None
    truck_number: str | None = Field(default=None, min_length=1, max_length=100)
    driver_name: str | None = None
    truck_location: str | None = None
    truck_latitude: float | None = None
    truck_longitude: float | None = None
    truck_model: str | None = None
    fuel_percentage: float | None = None
    registration_verified: bool | None = None
    inspection_paper_verified: bool | None = None
    sticker_verified: bool | None = None
    is_ca_fl_destination: bool | None = None
    bol_present: bool | None = None
    eld_mentioned: bool | None = None  # R17
    checklist_sent: bool | None = None  # R17
    weight: str | None = Field(default=None, max_length=100)
    trailer_condition: TrailerCondition | None = None
    condition_notes: str | None = None
    needs_scale: bool | None = None
    scale_ticket_received: bool | None = None
    pti_checklist: dict[str, bool] | None = None
    pti_verified: bool | None = None
    is_chassis: bool | None = None
    # R17: True keeps a DRAFT_IN_PROGRESS parked; False submits it into the
    # normal lifecycle. Not a column — consumed by the route, never setattr'd.
    still_sending: bool | None = None

    @field_validator("weight", mode="before")
    @classmethod
    def _weight_to_str(cls, v):
        return None if v is None else str(v)


class MediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    media_url: str
    media_type: MediaType
    created_at: datetime


class FlagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    flagged_by: uuid.UUID
    error_category: ErrorCategory
    severity: int | None
    notes: str | None
    created_at: datetime
    media: list[MediaOut] = []


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by: uuid.UUID
    creator: UserBrief
    mc_id: uuid.UUID
    motor_carrier: MCBrief
    truck_number: str
    is_lot_trailer: bool
    trailer_id: uuid.UUID | None
    state: TicketState

    driver_name: str | None
    truck_location: str | None
    truck_latitude: float | None
    truck_longitude: float | None
    truck_model: str | None
    fuel_percentage: float | None

    registration_verified: bool
    inspection_paper_verified: bool
    sticker_verified: bool
    is_ca_fl_destination: bool
    bol_present: bool
    eld_mentioned: bool
    checklist_sent: bool
    weight: str | None

    @field_validator("weight", mode="before")
    @classmethod
    def _weight_to_str(cls, v):
        return None if v is None else str(v)
    trailer_condition: TrailerCondition | None
    condition_notes: str | None
    needs_scale: bool
    scale_ticket_received: bool
    scale_requested_at: datetime | None
    submitted_to_qc_at: datetime | None
    pti_checklist: dict[str, bool] | None
    pti_verified: bool
    is_chassis: bool
    is_urgent_flag: bool
    resolved_by: uuid.UUID | None
    is_unresolvable: bool
    unresolvable_reason: str | None

    created_at: datetime
    updated_at: datetime
    audit_flags: list[FlagOut] = []
    # R20: historical context for the QC Review card — the most recent OTHER
    # ticket for this same truck/trailer that had the master PTI checkbox
    # verified. Only populated by GET /api/tickets/qc; None everywhere else.
    last_pti_date: datetime | None = None


class FlagMediaIn(BaseModel):
    url: str = Field(min_length=1, max_length=1000)
    media_type: MediaType


class FlagRequest(BaseModel):
    """One flag action may cite several error categories; one audit row is
    written per category. Notes required for 'Other'; severity (1-10) required
    for 'Didnt_Text_In_Group'. Media attachments are proof (uploads or URLs)."""

    error_categories: list[ErrorCategory] = Field(min_length=1)
    notes: str | None = None
    severity: int | None = Field(default=None, ge=1, le=10)
    media: list[FlagMediaIn] = []
    # R8 triage: urgent flags bypass Mistake Privacy (global visibility)
    is_urgent: bool = False

    @model_validator(mode="after")
    def validate_conditionals(self):
        if ErrorCategory.Other in self.error_categories and not (self.notes or "").strip():
            raise ValueError("Notes are required when flagging 'Other' — describe the problem.")
        if ErrorCategory.Didnt_Text_In_Group in self.error_categories and self.severity is None:
            raise ValueError(
                "A severity rating (1-10) is required for 'Didn't text in the group'."
            )
        return self


class UnresolvableRequest(BaseModel):
    """Escape hatch: the written explanation is mandatory."""

    reason: str = Field(min_length=5, max_length=2000)


class QCHistoryOut(BaseModel):
    """A ticket plus the timestamp of the QC action (approve/flag) that put it here."""

    processed_at: datetime
    ticket: TicketOut


class EmployeeStats(BaseModel):
    user_id: uuid.UUID
    username: str
    performance_score: int
    completed_daily: int
    completed_monthly: int
    completed_all_time: int
