"""Automated Shift Handover & Notes System.

- Drafts: auto-notes computed live from the caller's AWAITING_DRIVER tickets
  (R22: ONE consolidated note per truck listing every missing item) plus any
  ticket in a later state that still owes a scale ticket (R14: decoupled from
  APPROVED), + their manually typed DRAFT notes.
- Publish: persists auto-notes and flips manual drafts to PUBLISHED. R22:
  persisting a ticket's auto-note is ONE-SHOT — the ticket's
  auto_note_generated flag is set and the system never regenerates the note,
  so user deletions stay deleted and user edits are never overwritten.
- Global inbox: all PUBLISHED (unresolved) notes; anyone on shift can
  resolve ("Done") or edit them; auto notes are editable/deletable exactly
  like manual ones.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.models import NoteStatus, PickupTicket, ShiftNote, TicketState, User, UserRole
from app.schemas.note import AutoNoteOut, DraftsOut, NoteCreate, NoteOut, NoteUpdate, PublishResult
from app.services.ticket_lifecycle import _pti_gate_passed

router = APIRouter(tags=["notes"])

_note_query = select(ShiftNote).options(
    joinedload(ShiftNote.creator), joinedload(ShiftNote.resolver)
)


def _missing_items(t: PickupTicket) -> list[str]:
    """R22 trigger list: Inspection, Registration, BOL, PTI, Scale. The
    sticker counts as missing ONLY when the inspection paper is missing too
    (either document satisfies the QC gate)."""
    if t.state != TicketState.AWAITING_DRIVER:
        # Past AWAITING_DRIVER the only genuine follow-up is the scale
        # ticket (checklist gaps were consciously waved through by QC).
        return ["Scale Ticket"]
    missing: list[str] = []
    if not t.inspection_paper_verified:
        missing.append("Inspection Paper")
        if not t.sticker_verified:
            missing.append("Inspection Sticker")
    if not t.registration_verified:
        missing.append("Registration")
    if not t.bol_present:
        missing.append("BOL")
    if not _pti_gate_passed(t):
        missing.append("PTI")
    if t.needs_scale and not t.scale_ticket_received:
        missing.append("Scale Ticket")
    return missing


def _compute_auto_notes(db: Session, user: User) -> list[AutoNoteOut]:
    """R14: notes are decoupled from the ticket lifecycle. AWAITING_DRIVER
    tickets get the full missing-item scan; tickets in ANY later state -
    including APPROVED - still surface an outstanding scale ticket, because
    the truck may have left while dispatch still chases the driver for it.
    R22: one consolidated note per truck; tickets whose auto-note was already
    persisted once (auto_note_generated) are excluded forever."""
    tickets = (
        db.scalars(
            select(PickupTicket)
            .options(
                joinedload(PickupTicket.motor_carrier), joinedload(PickupTicket.trailer)
            )
            .where(
                PickupTicket.created_by == user.id,
                PickupTicket.auto_note_generated.is_(False),
                or_(
                    PickupTicket.state == TicketState.AWAITING_DRIVER,
                    and_(
                        # R17: parked drafts aren't in play yet — no notes
                        PickupTicket.state != TicketState.DRAFT_IN_PROGRESS,
                        PickupTicket.needs_scale.is_(True),
                        PickupTicket.scale_ticket_received.is_(False),
                    ),
                ),
            )
            .order_by(PickupTicket.created_at.asc())
        )
        .unique()
        .all()
    )
    notes: list[AutoNoteOut] = []
    for t in tickets:
        missing = _missing_items(t)
        if not missing:
            continue
        content = f"Truck {t.truck_number} has a missing {', '.join(missing)}"
        if t.is_ca_fl_destination:
            content += " — ALERT: CA/FL destination"
        notes.append(
            AutoNoteOut(
                ticket_id=t.id,
                truck_number=t.truck_number,
                mc_name=t.motor_carrier.name,
                missing_items=missing,
                content=content,
            )
        )
    return notes


def _get_note_or_404(db: Session, note_id: uuid.UUID) -> ShiftNote:
    note = db.scalar(_note_query.where(ShiftNote.id == note_id))
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return note


@router.get("/api/notes/drafts", response_model=DraftsOut)
def get_drafts(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    manual = (
        db.scalars(
            _note_query.where(
                ShiftNote.created_by == current_user.id,
                ShiftNote.status == NoteStatus.DRAFT,
            ).order_by(ShiftNote.created_at.asc())
        )
        .unique()
        .all()
    )
    return DraftsOut(auto_notes=_compute_auto_notes(db, current_user), manual_drafts=manual)


@router.post("/api/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_manual_draft(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    note = ShiftNote(
        created_by=current_user.id,
        content=payload.content.strip(),
        is_auto_generated=False,
        status=NoteStatus.DRAFT,
    )
    db.add(note)
    db.commit()
    return _get_note_or_404(db, note.id)


@router.post("/api/notes/publish", response_model=PublishResult)
def publish_shift_handover(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """The 'Publish Shift Handover' button: persist auto-notes + flip the
    caller's manual drafts to PUBLISHED. R22: persisting a ticket's auto-note
    is one-shot — the ticket's auto_note_generated flag is set here, so the
    note is never regenerated (deletions stay deleted, edits stay edited).
    Identical auto-notes already open on the global board are skipped."""
    auto_notes = _compute_auto_notes(db, current_user)

    open_auto_contents = set(
        db.scalars(
            select(ShiftNote.content).where(
                ShiftNote.status == NoteStatus.PUBLISHED,
                ShiftNote.is_auto_generated.is_(True),
            )
        ).all()
    )

    published_auto = 0
    skipped = 0
    for auto in auto_notes:
        if auto.content in open_auto_contents:
            skipped += 1
        else:
            db.add(
                ShiftNote(
                    created_by=current_user.id,
                    content=auto.content,
                    truck_number=auto.truck_number,
                    mc_name=auto.mc_name,
                    is_auto_generated=True,
                    status=NoteStatus.PUBLISHED,
                )
            )
            open_auto_contents.add(auto.content)
            published_auto += 1
        # One-shot flag: set even on skip so the ticket never re-offers a note
        ticket = db.get(PickupTicket, auto.ticket_id)
        if ticket is not None:
            ticket.auto_note_generated = True

    drafts = db.scalars(
        select(ShiftNote).where(
            ShiftNote.created_by == current_user.id, ShiftNote.status == NoteStatus.DRAFT
        )
    ).all()
    for note in drafts:
        note.status = NoteStatus.PUBLISHED

    db.commit()
    return PublishResult(
        published_auto=published_auto,
        published_manual=len(drafts),
        skipped_duplicates=skipped,
    )


@router.get("/api/notes/global", response_model=list[NoteOut])
def get_global_notes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The team inbox: PUBLISHED notes that haven't been resolved yet."""
    return (
        db.scalars(
            _note_query.where(ShiftNote.status == NoteStatus.PUBLISHED).order_by(
                ShiftNote.created_at.desc()
            )
        )
        .unique()
        .all()
    )


@router.patch("/api/notes/{note_id}/resolve", response_model=NoteOut)
def resolve_note(
    note_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    note = _get_note_or_404(db, note_id)
    if note.status != NoteStatus.PUBLISHED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only PUBLISHED notes can be resolved (current: {note.status.value}).",
        )
    note.status = NoteStatus.RESOLVED
    note.resolved_by = current_user.id
    note.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(note)
    return note


@router.delete("/api/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    """R18: notes are deletable by their author or a manager (any status).
    Resolve remains the normal way to close a published note — delete is for
    mistakes and stale entries."""
    note = _get_note_or_404(db, note_id)
    if current_user.role != UserRole.manager and note.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author or a manager can delete a note.",
        )
    db.delete(note)
    db.commit()


@router.patch("/api/notes/{note_id}", response_model=NoteOut)
def update_note(
    note_id: uuid.UUID,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.qc, UserRole.manager)),
):
    note = _get_note_or_404(db, note_id)
    if note.status == NoteStatus.RESOLVED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Resolved notes cannot be edited."
        )
    # Drafts are private to their author; published notes are a shared board.
    if note.status == NoteStatus.DRAFT and note.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can edit a draft note.",
        )
    note.content = payload.content.strip()
    db.commit()
    db.refresh(note)
    return note
