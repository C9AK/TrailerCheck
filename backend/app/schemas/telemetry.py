from pydantic import BaseModel


class TelemetryResponse(BaseModel):
    driver_name: str
    location: str  # full formatted address
    model: str  # "YEAR MAKE MODEL"
    fuel_percentage: float | None = None
    latitude: float | None = None
    longitude: float | None = None
