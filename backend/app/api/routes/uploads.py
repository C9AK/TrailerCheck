"""QC flag proof uploads (images/videos). Files are stored in backend/media/
and served statically at /media/*. Pickup-form PTI remains checkbox-only —
uploads exist solely for the QC flag flow."""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.deps import require_roles
from app.models import UserRole

MEDIA_DIR = Path(__file__).resolve().parents[3] / "media"
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB

router = APIRouter(tags=["uploads"])


@router.post("/api/uploads")
async def upload_media(
    file: UploadFile = File(...),
    current_user=Depends(require_roles(UserRole.qc, UserRole.manager)),
):
    content_type = file.content_type or ""
    if content_type.startswith("image/"):
        media_type = "image"
    elif content_type.startswith("video/"):
        media_type = "video"
    else:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image or video files are accepted.",
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

    return {"url": f"/media/{name}", "media_type": media_type}
