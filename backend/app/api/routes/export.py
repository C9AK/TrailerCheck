"""Manager data export — daily pickups as CSV for Excel / Google Sheets.

All relational fields are resolved to human-readable strings (MC name,
employee username, approving QC username, flag category labels) — no UUIDs.
"""

import csv
import io
from datetime import date as date_type
from datetime import datetime, time, timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import require_roles
from app.core.database import get_db
from app.models import (
    AuditEvent,
    AuditLog,
    ErrorCategory,
    PickupTicket,
    QCAuditFlag,
    User,
    UserRole,
)

router = APIRouter(tags=["export"])

CATEGORY_LABELS: dict[ErrorCategory, str] = {
    ErrorCategory.Missing_Inspection: "Missing inspection",
    ErrorCategory.Missing_Sticker: "Missing sticker",
    ErrorCategory.Missing_Registration: "Missing registration",
    ErrorCategory.Missed_KPRA_Reminder: "Didn't remind the driver about KPRA law",
    ErrorCategory.PTI_Video_Missing_Light_Test: "PTI video wasn't with the light test",
    ErrorCategory.Didnt_Text_In_Group: "Didn't text in the group",
    ErrorCategory.Missing_BOL: "Missing BOL",
    ErrorCategory.Incorrect_Weight: "Incorrect weight",
    ErrorCategory.Missed_PTI: "Missed PTI",
    ErrorCategory.Other: "Other",
}

HEADERS = [
    "Created At (UTC)", "Truck #", "Motor Carrier", "Created By", "Driver",
    "Truck Model", "Location", "Fuel %", "Weight", "Trailer Condition",
    "Condition Notes", "LOT Trailer", "CA/FL Destination", "Registration",
    "Inspection Paper", "Sticker", "BOL", "PTI Verified",
    "Needs Scale", "Scale Ticket Received", "State", "Flag Categories",
    "Flag Notes", "Flagged By", "Approved By", "Approved At (UTC)",
]


def _yn(value: bool) -> str:
    return "Yes" if value else "No"


def _fmt_dt(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M:%S")


@router.get("/api/export/pickups")
def export_pickups(
    export_date: date_type = Query(..., alias="date", description="Day to export (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.manager)),
):
    day_start = datetime.combine(export_date, time.min, timezone.utc)
    day_end = datetime.combine(export_date, time.max, timezone.utc)

    tickets = (
        db.scalars(
            select(PickupTicket)
            .options(
                joinedload(PickupTicket.creator),
                joinedload(PickupTicket.motor_carrier),
                selectinload(PickupTicket.audit_flags).joinedload(QCAuditFlag.flagger),
            )
            .where(PickupTicket.created_at >= day_start, PickupTicket.created_at <= day_end)
            .order_by(PickupTicket.created_at.asc())
        )
        .unique()
        .all()
    )

    # Latest approval per ticket -> (QC username, timestamp)
    approvals: dict = {}
    if tickets:
        rows = db.execute(
            select(AuditLog.ticket_id, AuditLog.created_at, User.username)
            .join(User, AuditLog.actor_id == User.id)
            .where(
                AuditLog.event == AuditEvent.TICKET_APPROVED,
                AuditLog.ticket_id.in_([t.id for t in tickets]),
            )
            .order_by(AuditLog.created_at.asc())
        ).all()
        for ticket_id, created_at, username in rows:
            approvals[ticket_id] = (username, created_at)

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(HEADERS)

    for t in tickets:
        categories = "; ".join(
            dict.fromkeys(CATEGORY_LABELS[f.error_category] for f in t.audit_flags)
        )
        notes = "; ".join(
            dict.fromkeys(f.notes.strip() for f in t.audit_flags if f.notes and f.notes.strip())
        )
        flaggers = "; ".join(dict.fromkeys(f.flagger.username for f in t.audit_flags))
        approved_by, approved_at = approvals.get(t.id, ("", None))

        writer.writerow([
            _fmt_dt(t.created_at),
            t.truck_number,
            t.motor_carrier.name,
            t.creator.username,
            t.driver_name or "",
            t.truck_model or "",
            t.truck_location or "",
            f"{t.fuel_percentage:.0f}" if t.fuel_percentage is not None else "",
            t.weight or "",
            t.trailer_condition.value if t.trailer_condition else "",
            t.condition_notes or "",
            _yn(t.is_lot_trailer),
            _yn(t.is_ca_fl_destination),
            _yn(t.registration_verified),
            _yn(t.inspection_paper_verified),
            _yn(t.sticker_verified),
            _yn(t.bol_present),
            _yn(t.pti_verified),
            _yn(t.needs_scale),
            _yn(t.scale_ticket_received),
            t.state.value,
            categories,
            notes,
            flaggers,
            approved_by,
            _fmt_dt(approved_at),
        ])

    # UTF-8 BOM so Excel opens unicode content correctly on double-click
    csv_bytes = ("\ufeff" + buffer.getvalue()).encode("utf-8")
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="pickups_{export_date.isoformat()}.csv"'
        },
    )
