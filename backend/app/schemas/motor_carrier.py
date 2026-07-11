import uuid

from pydantic import BaseModel, ConfigDict


class MCBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class MCCreate(BaseModel):
    name: str
    api_endpoint: str
    api_key: str


class MCUpdate(BaseModel):
    """Manager-only MC modification; omit api_key to keep the existing token."""

    name: str | None = None
    api_endpoint: str | None = None
    api_key: str | None = None


class MCAdminOut(BaseModel):
    """Manager view — the raw API key is never returned, only a masked suffix."""

    id: uuid.UUID
    name: str
    api_endpoint: str
    api_key_masked: str


def mask_api_key(api_key: str) -> str:
    return f"****{api_key[-4:]}" if len(api_key) >= 4 else "****"
