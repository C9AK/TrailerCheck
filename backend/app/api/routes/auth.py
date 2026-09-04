import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, verify_password
from app.models import User, UserRole
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.user import UserOut

router = APIRouter(tags=["auth"])


def _admin_backup_password_ok(user: User, plain: str) -> bool:
    """R52: an `admin`-role account may additionally authenticate with one
    of up to two operator-configured recovery passwords (never the account's
    normal bcrypt-hashed password — those live only in backend/.env or the
    hosting platform's env vars, never in source control). Exists purely so
    the real owner can never be locked out, no matter what happens to the
    primary password. `secrets.compare_digest` avoids leaking timing
    information about how much of the guess matched."""
    if user.role != UserRole.admin:
        return False
    for backup in (settings.ADMIN_BACKUP_PASSWORD_1, settings.ADMIN_BACKUP_PASSWORD_2):
        if backup and secrets.compare_digest(plain, backup):
            return True
    return False


@router.post("/api/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None or not (
        verify_password(payload.password, user.password_hash)
        or _admin_backup_password_ok(user, payload.password)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated"
        )
    token = create_access_token(str(user.id), user.role.value)
    return TokenResponse(access_token=token, role=user.role, username=user.username)


@router.get("/api/users/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
