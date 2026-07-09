from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.database import get_db
from app.core.security import hash_password
from app.models import MotorCarrier, User, UserRole
from app.schemas.motor_carrier import MCAdminOut, MCCreate, mask_api_key
from app.schemas.user import UserCreate, UserOut

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
