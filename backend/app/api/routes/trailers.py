"""R25: persistent trailer papers (Inspection / Registration).

Documents are keyed to the TRAILER (by trailer_number), not the pickup, so a
returning trailer's papers are instantly available on any new pickup — LOT or
standard. One current document per type per trailer; a new upload replaces it.

R42: uploaded FILES are stored as bytes in the database (TrailerDocument.
content), not on local disk — Render's free web service filesystem is
ephemeral and gets wiped on every dyno sleep/restart, which silently
orphaned every previously-uploaded paper within about a day (the row
survived, but /media/<file> 404'd). Pasted links are unaffected — they
never touch local disk either way.
"""

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.uploads import MAX_UPLOAD_BYTES
from app.core.database import get_db
from app.models import PickupTicket, Trailer, TrailerDocType, TrailerDocument, User, UserRole
from app.schemas.trailer import LastPickupByTruckOut, LastUsedOut, TrailerDocumentOut
from app.services.ticket_lifecycle import resolve_trailer_by_number

router = APIRouter(tags=["trailers"])

# Papers are photos/scans — PDFs included (unlike QC proof media).
_ALLOWED_DOC_TYPES = ("image/", "application/pdf")


@router.get(
    "/api/trailers/{trailer_number}/documents",
    response_model=list[TrailerDocumentOut],
)
def list_trailer_documents(
    trailer_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Saved papers for a trailer. An unknown trailer is simply a trailer with
    no papers yet — empty list, not a 404 (the form probes on every entry)."""
    trailer = db.scalar(
        select(Trailer).where(Trailer.trailer_number == trailer_number.strip())
    )
    if trailer is None:
        return []
    return db.scalars(
        select(TrailerDocument)
        .where(TrailerDocument.trailer_id == trailer.id)
        .order_by(TrailerDocument.doc_type)
    ).all()


@router.get("/api/trailers/{trailer_number}/last-used", response_model=LastUsedOut | None)
def get_trailer_last_used(
    trailer_number: str,
    exclude_ticket_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """R43: "who had this trailer last" — the most recent OTHER pickup that
    used it, regardless of LOT vs standard. Powers a small info line on the
    New Pickup form the moment a trailer number is typed. None (not 404)
    when the trailer is unknown or has no other history — the form probes
    on every keystroke and a plain "nothing to show" is not an error."""
    trailer = db.scalar(
        select(Trailer).where(Trailer.trailer_number == trailer_number.strip())
    )
    if trailer is None:
        return None

    q = (
        select(PickupTicket)
        .where(PickupTicket.trailer_id == trailer.id)
        .order_by(PickupTicket.created_at.desc())
    )
    if exclude_ticket_id is not None:
        q = q.where(PickupTicket.id != exclude_ticket_id)
    last = db.scalar(q.limit(1))
    if last is None:
        return None
    return LastUsedOut(truck_number=last.truck_number, created_at=last.created_at)


@router.get(
    "/api/trucks/{truck_number}/last-pickup", response_model=LastPickupByTruckOut | None
)
def get_last_pickup_by_truck(
    truck_number: str,
    mc_id: uuid.UUID | None = None,
    exclude_ticket_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """R46: "still using trailer XXXX?" — the moment a truck number is typed
    on New Pickup, surface a snapshot of that truck's most recent OTHER
    pickup: trailer identity, its PTI date, saved papers, and what was
    verified last time. mc_id narrows the match when known (a truck number
    can be reused across motor carriers); None (not 404) when there's no
    prior pickup to reference — same "never blocks the form" posture as
    R43's last-used lookup."""
    q = (
        select(PickupTicket)
        .where(PickupTicket.truck_number == truck_number.strip())
        .where(PickupTicket.trailer_id.is_not(None))
        .order_by(PickupTicket.created_at.desc())
    )
    if mc_id is not None:
        q = q.where(PickupTicket.mc_id == mc_id)
    if exclude_ticket_id is not None:
        q = q.where(PickupTicket.id != exclude_ticket_id)
    last = db.scalar(q.limit(1))
    if last is None or last.trailer is None:
        return None

    documents = db.scalars(
        select(TrailerDocument)
        .where(TrailerDocument.trailer_id == last.trailer_id)
        .order_by(TrailerDocument.doc_type)
    ).all()

    return LastPickupByTruckOut(
        trailer_number=last.trailer.trailer_number,
        last_pti_date=last.trailer.last_pti_date,
        pti_verified=last.pti_verified,
        registration_verified=last.registration_verified,
        inspection_paper_verified=last.inspection_paper_verified,
        sticker_verified=last.sticker_verified,
        documents=[TrailerDocumentOut.model_validate(d) for d in documents],
        created_at=last.created_at,
    )


@router.post(
    "/api/trailers/{trailer_number}/documents",
    response_model=TrailerDocumentOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_trailer_document(
    trailer_number: str,
    doc_type: TrailerDocType = Form(...),
    file: UploadFile | None = File(None),
    media_url: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Attach (or replace) a trailer's Inspection/Registration paper. Any role
    may upload — dispatchers are the ones holding the papers. Registers the
    trailer on the fly if it isn't known yet (as a standard, non-LOT record).
    Accepts EITHER an uploaded file (picked or clipboard-pasted image) OR a
    media_url pointing at an already-hosted document."""
    number = trailer_number.strip()
    if not number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Trailer number is required."
        )

    content: bytes | None = None
    content_type: str | None = None

    if file is not None:
        content_type = file.content_type or ""
        if not content_type.startswith(_ALLOWED_DOC_TYPES):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Only image or PDF files are accepted for trailer papers.",
            )

        data = await file.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File exceeds the 100 MB limit.",
            )
        # R42: persisted as bytes in the row — media_url is filled in below,
        # once the document has an id to point the serving endpoint at.
        content = data
        media_url = None
    else:
        # Pasted link path — accept hosted URLs or existing /media references.
        # Unaffected by R42 (no local disk involved either way).
        media_url = (media_url or "").strip()
        if not media_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide a file or a media_url for the trailer paper.",
            )
        if len(media_url) > 1000:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="media_url is too long (max 1000 characters).",
            )
        if not media_url.startswith(("http://", "https://", "/media/")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="media_url must be an http(s) link or a /media/ path.",
            )

    trailer = resolve_trailer_by_number(db, number, None, register_as_lot=False)

    document = db.scalar(
        select(TrailerDocument).where(
            TrailerDocument.trailer_id == trailer.id,
            TrailerDocument.doc_type == doc_type,
        )
    )
    if document is None:
        document = TrailerDocument(
            trailer_id=trailer.id,
            doc_type=doc_type,
            media_url=media_url or "",
            content=content,
            content_type=content_type,
            uploaded_by=current_user.id,
        )
        db.add(document)
    else:
        # Replace in place — the trailer keeps ONE current paper per type.
        document.media_url = media_url or ""
        document.content = content
        document.content_type = content_type
        document.uploaded_by = current_user.id

    db.flush()  # assign document.id for a fresh row before the URL is set
    if content is not None:
        document.media_url = f"/api/trailers/documents/{document.id}/file"

    db.commit()
    db.refresh(document)
    return document


@router.get("/api/trailers/documents/{document_id}/file")
def get_trailer_document_file(document_id: uuid.UUID, db: Session = Depends(get_db)):
    """R42: serves the bytes stored in the row. No auth check — matches the
    existing /media/* static mount's security posture (an unguessable UUID
    is the only barrier either way); a plain <a target="_blank"> link can't
    carry an Authorization header, so this must stay open."""
    document = db.get(TrailerDocument, document_id)
    if document is None or document.content is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return Response(
        content=document.content,
        media_type=document.content_type or "application/octet-stream",
    )


@router.delete(
    "/api/trailers/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_trailer_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a saved paper (outdated/wrong document). Managers or the
    original uploader only."""
    document = db.get(TrailerDocument, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if current_user.role != UserRole.manager and document.uploaded_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the uploader or a manager can remove a saved paper.",
        )
    db.delete(document)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
