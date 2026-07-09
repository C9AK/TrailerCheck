"""Read-only lookups needed by the New Pickup form (MC dropdown, LOT DatePicker prefill)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import MotorCarrier, Trailer
from app.schemas.motor_carrier import MCBrief
from app.schemas.trailer import TrailerOut

router = APIRouter(tags=["lookups"], dependencies=[Depends(get_current_user)])


@router.get("/api/mcs", response_model=list[MCBrief])
def list_motor_carriers(db: Session = Depends(get_db)):
    return db.scalars(select(MotorCarrier).order_by(MotorCarrier.name)).all()


@router.get("/api/trailers/{trailer_number}", response_model=TrailerOut)
def get_trailer(trailer_number: str, db: Session = Depends(get_db)):
    trailer = db.scalar(select(Trailer).where(Trailer.trailer_number == trailer_number))
    if trailer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trailer not found"
        )
    return trailer
