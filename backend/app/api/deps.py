import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import JWTError, decode_access_token
from app.models import User, UserRole

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive"
        )
    return user


def require_roles(*roles: UserRole):
    """R52: a bare `require_roles(UserRole.manager)` (or any tuple
    containing it) is automatically satisfied by `UserRole.admin` too —
    admin carries every manager capability, so route definitions written
    before admin existed never needed to change. Admin is additionally
    PROTECTED *from* managers, but that's a narrower rule enforced inline
    where it matters (app.api.routes.admin), not something this generic
    permission gate can express."""

    def checker(current_user: User = Depends(get_current_user)) -> User:
        allowed = set(roles)
        if UserRole.manager in allowed:
            allowed.add(UserRole.admin)
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action",
            )
        return current_user

    return checker
