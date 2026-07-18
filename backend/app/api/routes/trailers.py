"""R25: persistent trailer papers (Inspection / Registration).

Documents are keyed to the TRAILER (by trailer_number), not the pickup, so a
returning trailer's papers are instantly available on any new pickup — LOT or
standard. One current document per type per trailer; a new upload replaces it.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.uploads import MAX_UPLOAD_BYTES, MEDIA_DIR
from app.core.database import get_db
from app.models import Trailer, TrailerDocType, TrailerDocument, User, UserRole
from app.schemas.trailer import TrailerDocumentOut
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

        suffix = Path(file.filename or "").suffix.lower()[:10]
        name = f"{uuid.uuid4().hex}{suffix}"
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        (MEDIA_DIR / name).write_bytes(data)
        media_url = f"/media/{name}"
    else:
        # Pasted link path — accept hosted URLs or existing /media references.
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
            media_url=media_url,
            uploaded_by=current_user.id,
        )
        db.add(document)
    else:
        # Replace in place — the trailer keeps ONE current paper per type.
        document.media_url = media_url
        document.uploaded_by = current_user.id

    db.commit()
    db.refresh(document)
    return document


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
