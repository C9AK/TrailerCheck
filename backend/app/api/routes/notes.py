"""Automated Shift Handover & Notes System.

- Drafts: auto-notes computed live from the caller's AWAITING_DRIVER tickets
  (one note per missing checklist item) + their manually typed DRAFT notes.
- Publish: persists auto-notes and flips manual drafts to PUBLISHED,
  skipping duplicates already open on the global board.
- Global inbox: all PUBLISHED (unresolved) notes; anyone on shift can
  resolve ("Done") or edit them.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.models import NoteStatus, PickupTicket, ShiftNote, TicketState, User, UserRole
from app.schemas.note import AutoNoteOut, DraftsOut, NoteCreate, NoteOut, NoteUpdate, PublishResult
from app.services.ticket_lifecycle import _pti_gate_passed

router = APIRouter(tags=["notes"])

MISSING_ITEMS: list[tuple[str, str]] = [
    ("registration_verified", "Registration"),
    ("inspection_paper_verified", "Inspection Paper"),
    ("sticker_verified", "Sticker"),
    ("bol_present", "BOL"),
]

_note_query = select(ShiftNote).options(
    joinedload(ShiftNote.creator), joinedload(ShiftNote.resolver)
)


def _compute_auto_notes(db: Session, user: User) -> list[AutoNoteOut]:
    tickets = (
        db.scalars(
            select(PickupTicket)
            .options(
                joinedload(PickupTicket.motor_carrier), joinedload(PickupTicket.trailer)
            )
            .where(
                PickupTicket.created_by == user.id,
                PickupTicket.state == TicketState.AWAITING_DRIVER,
            )
            .order_by(PickupTicket.created_at.asc())
        )
        .unique()
        .all()
    )
    notes: list[AutoNoteOut] = []
    for t in tickets:
        missing = [label for field, label in MISSING_ITEMS if not getattr(t, field)]
        if t.needs_scale and not t.scale_ticket_received:
            missing.append("Scale Ticket")
        if not _pti_gate_passed(t):
            missing.append("PTI")
        for item in missing:
            notes.append(
                AutoNoteOut(
                    truck_number=t.truck_number,
                    mc_name=t.motor_carrier.name,
                    missing_item=item,
                    content=f"Truck {t.truck_number} - {t.motor_carrier.name}: Waiting on {item}",
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
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
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
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
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
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
):
    """The 'Publish Shift Handover' button: persist auto-notes + flip the
    caller's manual drafts to PUBLISHED. Identical auto-notes already open on
    the global board are skipped."""
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
            continue
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
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
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


@router.patch("/api/notes/{note_id}", response_model=NoteOut)
def update_note(
    note_id: uuid.UUID,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.employee, UserRole.manager)),
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
