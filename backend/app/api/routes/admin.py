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
    PickupTicket,
    QCAuditFlag,
    ShiftNote,
    User,
    UserRole,
)
from app.schemas.motor_carrier import MCAdminOut, MCCreate, MCUpdate, mask_api_key
from app.schemas.user import UserCreate, UserOut, UserUpdate

router = APIRouter(tags=["admin"], dependencies=[Depends(require_roles(UserRole.manager))])


@router.post("/api/admin/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
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

    # Lockout guards: a manager cannot demote or deactivate themselves.
    if user.id == current_user.id and (
        (payload.role is not None and payload.role != UserRole.manager)
        or payload.is_active is False
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot demote or deactivate your own account.",
        )

    if payload.username and payload.username != user.username:
        if db.scalar(select(User).where(User.username == payload.username)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Username already exists"
            )
        user.username = payload.username
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active

    db.commit()
    db.refresh(user)
    return user


@router.delete("/api/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
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
