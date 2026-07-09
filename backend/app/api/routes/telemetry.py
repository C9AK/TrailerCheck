import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import MotorCarrier
from app.schemas.telemetry import TelemetryResponse
from app.services.telemetry import TruckNotFoundError, fetch_truck_telemetry

router = APIRouter(tags=["telemetry"], dependencies=[Depends(get_current_user)])


@router.get(
    "/api/telemetry/truck/{mc_id}/{truck_number}", response_model=TelemetryResponse
)
async def get_truck_telemetry(
    mc_id: uuid.UUID, truck_number: str, db: Session = Depends(get_db)
):
    mc = db.get(MotorCarrier, mc_id)
    if mc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Motor Carrier not found"
        )
    try:
        data = await fetch_truck_telemetry(mc, truck_number)
    except TruckNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Truck '{truck_number}' not found in {mc.name}'s fleet.",
        )
    return TelemetryResponse(**data)
