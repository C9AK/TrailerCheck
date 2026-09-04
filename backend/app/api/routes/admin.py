import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.core.security import hash_password
from app.models import (
    AuditLog,
    LiveActivityFeed,
    MotorCarrier,
    PasswordChangeAudit,
    PickupTicket,
    QCAuditFlag,
    ShiftNote,
    User,
    UserRole,
)
from app.schemas.motor_carrier import MCAdminOut, MCCreate, MCUpdate, mask_api_key
from app.schemas.user import PasswordChangeEventOut, UserCreate, UserOut, UserUpdate

# require_roles(UserRole.manager) already admits UserRole.admin too (see
# api.deps) — admin carries every manager capability here. The narrower
# rule that PROTECTS admin accounts FROM managers is enforced inline below,
# per-route, since it depends on which account is being acted on, not just
# who's asking.
router = APIRouter(tags=["admin"], dependencies=[Depends(require_roles(UserRole.manager))])


@router.post("/api/admin/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # R52: granting admin privileges requires ALREADY being an admin —
    # otherwise any manager could simply create a fresh admin account for
    # themselves and bypass the entire protection model.
    if payload.role == UserRole.admin and current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin can create another admin account.",
        )
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username already exists"
        )
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/api/admin/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.username)).all()


@router.patch("/api/admin/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # R52: admin accounts are protected from EVERYONE but their own owner —
    # not even another manager (or a different admin) may touch them. This
    # is the account-level enforcement behind "no one can change my
    # password": combined with the role-escalation guard below (only an
    # admin can ever GRANT admin), an admin account can only be modified by
    # logging in as that exact account.
    if user.role == UserRole.admin and user.id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin accounts can only be modified by their own owner.",
        )

    # R52: granting admin privileges to ANY account (including via the
    # self-edit path, which the lockout guard below blocks anyway) requires
    # already being an admin.
    if payload.role == UserRole.admin and current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin can grant admin privileges.",
        )

    # Lockout guard: nobody may change their OWN role or deactivate
    # themselves via this endpoint — generalized (R52) from the original
    # manager-only wording so admin is covered identically, without a
    # separate special case.
    if user.id == current_user.id and (
        (payload.role is not None and payload.role != user.role) or payload.is_active is False
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot change your own role or deactivate your own account.",
        )

    if payload.username and payload.username != user.username:
        if db.scalar(select(User).where(User.username == payload.username)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Username already exists"
            )
        user.username = payload.username
    if payload.password:
        user.password_hash = hash_password(payload.password)
        # R52: alert the admin whenever a password is changed on an account
        # that ISN'T the changer's own. The admin-protection guard above
        # already makes this unreachable for an admin's own account, so in
        # practice this fires for a manager changing an employee/qc/manager
        # password (or, if a second admin ever exists, an admin changing
        # someone else's).
        if current_user.id != user.id:
            db.add(
                PasswordChangeAudit(
                    target_user_id=user.id,
                    changed_by=current_user.id,
                    target_username=user.username,
                    changed_by_username=current_user.username,
                )
            )
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active

    db.commit()
    db.refresh(user)
    return user


@router.get("/api/admin/password-changes", response_model=list[PasswordChangeEventOut])
def get_password_change_log(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.admin)),
):
    """R52: the admin's personal security feed — every password change
    performed on an account other than the changer's own, newest first.
    Admin-ONLY (the router's own manager-or-admin gate isn't enough here —
    this route pins the stricter role itself): this is the top-level
    account holder's visibility tool, not a general team feature, so a
    manager gets a 403 same as anyone else without admin privileges."""
    return db.scalars(
        select(PasswordChangeAudit)
        .order_by(PasswordChangeAudit.created_at.desc())
        .limit(min(limit, 200))
    ).all()


@router.delete("/api/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    # R52: admin accounts can never be deleted — by anyone, including
    # themselves. Checked before the generic self-delete guard below so the
    # error message is specific to the actual reason.
    if user.role == UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin accounts cannot be deleted.",
        )
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot delete your own account.",
        )

    # Users with recorded activity are preserved for accountability — the
    # history tables reference them. Deactivate those instead.
    activity = (
        (db.scalar(select(sa_func.count()).where(PickupTicket.created_by == user.id)) or 0)
        + (db.scalar(select(sa_func.count()).where(QCAuditFlag.flagged_by == user.id)) or 0)
        + (db.scalar(select(sa_func.count()).where(ShiftNote.created_by == user.id)) or 0)
        + (db.scalar(select(sa_func.count()).where(AuditLog.actor_id == user.id)) or 0)
        + (db.scalar(select(sa_func.count()).where(LiveActivityFeed.actor_id == user.id)) or 0)
        # R52: a user this table references (either side) is also
        # preserved — deleting them would either erase part of the admin's
        # security trail or leave a dangling FK.
        + (
            db.scalar(
                select(sa_func.count()).where(PasswordChangeAudit.target_user_id == user.id)
            )
            or 0
        )
        + (
            db.scalar(select(sa_func.count()).where(PasswordChangeAudit.changed_by == user.id))
            or 0
        )
    )
    if activity > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This user has recorded activity (tickets, flags, or notes) and "
                "cannot be hard-deleted — deactivate the account instead."
            ),
        )

    db.delete(user)
    db.commit()


@router.post("/api/admin/mcs", response_model=MCAdminOut, status_code=status.HTTP_201_CREATED)
def create_motor_carrier(payload: MCCreate, db: Session = Depends(get_db)):
    if db.scalar(select(MotorCarrier).where(MotorCarrier.name == payload.name)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Motor Carrier already exists"
        )
    mc = MotorCarrier(**payload.model_dump())
    db.add(mc)
    db.commit()
    db.refresh(mc)
    return MCAdminOut(
        id=mc.id,
        name=mc.name,
        api_endpoint=mc.api_endpoint,
        api_key_masked=mask_api_key(mc.api_key),
    )


@router.patch("/api/admin/mcs/{mc_id}", response_model=MCAdminOut)
def update_motor_carrier(
    mc_id: uuid.UUID,
    payload: MCUpdate,
    db: Session = Depends(get_db),
):
    mc = db.get(MotorCarrier, mc_id)
    if mc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Motor Carrier not found"
        )
    if payload.name and payload.name != mc.name:
        if db.scalar(select(MotorCarrier).where(MotorCarrier.name == payload.name)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Motor Carrier name already exists"
            )
        mc.name = payload.name
    if payload.api_endpoint:
        mc.api_endpoint = payload.api_endpoint
    if payload.api_key:
        mc.api_key = payload.api_key
    db.commit()
    db.refresh(mc)
    return MCAdminOut(
        id=mc.id,
        name=mc.name,
        api_endpoint=mc.api_endpoint,
        api_key_masked=mask_api_key(mc.api_key),
    )


@router.get("/api/admin/mcs", response_model=list[MCAdminOut])
def list_motor_carriers_admin(db: Session = Depends(get_db)):
    mcs = db.scalars(select(MotorCarrier).order_by(MotorCarrier.name)).all()
    return [
        MCAdminOut(
            id=mc.id,
            name=mc.name,
            api_endpoint=mc.api_endpoint,
            api_key_masked=mask_api_key(mc.api_key),
        )
        for mc in mcs
    ]
