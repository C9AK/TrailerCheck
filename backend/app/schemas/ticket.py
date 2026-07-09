import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    tires_inspected: bool = False
    bol_present: bool = False
    weight: float | None = None
    trailer_condition: TrailerCondition | None = None
    condition_notes: str | None = None
    needs_scale: bool = False
    scale_ticket_received: bool = False
    # R2: optional at save time; gates the -> PENDING_QC transition instead
    pti_verified: bool = False


class TicketUpdate(BaseModel):
    """PATCH payload for inline edits — every field optional; state is server-controlled."""

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
    tires_inspected: bool | None = None
    bol_present: bool | None = None
    weight: float | None = None
    trailer_condition: TrailerCondition | None = None
    condition_notes: str | None = None
    needs_scale: bool | None = None
    scale_ticket_received: bool | None = None
    pti_verified: bool | None = None


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
    tires_inspected: bool
    bol_present: bool
    weight: float | None
    trailer_condition: TrailerCondition | None
    condition_notes: str | None
    needs_scale: bool
    scale_ticket_received: bool
    scale_requested_at: datetime | None
    pti_verified: bool

    created_at: datetime
    updated_at: datetime
    audit_flags: list[FlagOut] = []


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

    @model_validator(mode="after")
    def validate_conditionals(self):
        if ErrorCategory.Other in self.error_categories and not (self.notes or "").strip():
            raise ValueError("Notes are required when flagging 'Other' — describe the problem.")
        if ErrorCategory.Didnt_Text_In_Group in self.error_categories and self.severity is None:
            raise ValueError(
                "A severity rating (1-10) is required for 'Didn't text in the group'."
            )
        return self


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
