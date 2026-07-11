"""Multi-MC telemetry proxy.

Looks up the MC's own api_endpoint/api_key and makes a server-to-server call.
MCs whose endpoint points at Samsara use the real Samsara Fleet API:
  1. GET /fleet/vehicles           -> match vehicle by name == truck number
  2. GET /fleet/vehicles/stats     -> gps location + fuel percent
  3. GET /fleet/driver-vehicle-assignments -> current driver (fallback: static)
Any transport/auth failure falls back to deterministic mock data
(03-Backend-API-Spec.md); an unknown truck number raises TruckNotFoundError.
"""

import hashlib

import httpx

from app.models import MotorCarrier


class TruckNotFoundError(Exception):
    """The fleet API answered, but no vehicle matches this truck number."""


_MOCK_DRIVERS = ["James Carter", "Maria Lopez", "Dmitri Ivanov", "Ahmed Hassan", "Sarah Chen"]
_MOCK_LOCATIONS = [
    "Chicago, IL - Yard 4",
    "Dallas, TX - I-35 Mile 402",
    "Atlanta, GA - Fulton Industrial Blvd",
    "Newark, NJ - Port Terminal B",
    "Phoenix, AZ - Loop 202",
]
_MOCK_MODELS = ["Freightliner Cascadia", "Kenworth T680", "Peterbilt 579", "Volvo VNL 860"]


def _mock_telemetry(truck_number: str) -> dict:
    seed = int(hashlib.md5(truck_number.encode()).hexdigest(), 16)
    return {
        "driver_name": _MOCK_DRIVERS[seed % len(_MOCK_DRIVERS)],
        "location": _MOCK_LOCATIONS[seed % len(_MOCK_LOCATIONS)],
        "model": f"{2018 + seed % 8} {_MOCK_MODELS[seed % len(_MOCK_MODELS)]}",
        "fuel_percentage": float(20 + seed % 76),
        "latitude": round(30.0 + (seed % 1500) / 100, 4),
        "longitude": round(-120.0 + (seed % 4500) / 100, 4),
    }


async def _find_samsara_vehicle(client: httpx.AsyncClient, truck_number: str) -> dict | None:
    """Page through /fleet/vehicles matching name to the truck number.
    Alphanumeric names with spaces (e.g. "1319 A") are matched with whitespace
    normalized on both sides."""
    wanted = " ".join(truck_number.split()).lower()
    after: str | None = None
    for _ in range(10):  # safety cap: 10 pages x 512 vehicles
        params: dict = {"limit": 512}
        if after:
            params["after"] = after
        resp = await client.get("/fleet/vehicles", params=params)
        resp.raise_for_status()
        body = resp.json()
        for vehicle in body.get("data", []):
            if " ".join(str(vehicle.get("name", "")).split()).lower() == wanted:
                return vehicle
        pagination = body.get("pagination", {})
        if not pagination.get("hasNextPage"):
            return None
        after = pagination.get("endCursor")
    return None


async def _fetch_samsara(mc: MotorCarrier, truck_number: str) -> dict:
    headers = {"Authorization": f"Bearer {mc.api_key}"}
    async with httpx.AsyncClient(
        base_url="https://api.samsara.com", headers=headers, timeout=15.0
    ) as client:
        vehicle = await _find_samsara_vehicle(client, truck_number)
        if vehicle is None:
            raise TruckNotFoundError(truck_number)
        vehicle_id = vehicle["id"]

        # Location + fuel
        location = "Unknown"
        latitude: float | None = None
        longitude: float | None = None
        fuel: float | None = None
        try:
            resp = await client.get(
                "/fleet/vehicles/stats",
                params={"vehicleIds": vehicle_id, "types": "gps,fuelPercents"},
            )
            resp.raise_for_status()
            stats_list = resp.json().get("data", [])
            if stats_list:
                stats = stats_list[0]
                gps = stats.get("gps") or {}
                reverse_geo = gps.get("reverseGeo") or {}
                if gps.get("latitude") is not None:
                    latitude = float(gps["latitude"])
                if gps.get("longitude") is not None:
                    longitude = float(gps["longitude"])
                location = reverse_geo.get("formattedLocation") or (
                    f"{latitude:.4f}, {longitude:.4f}"
                    if latitude is not None and longitude is not None
                    else "Unknown"
                )
                fuel_stat = stats.get("fuelPercent") or {}
                if fuel_stat.get("value") is not None:
                    fuel = float(fuel_stat["value"])
        except httpx.HTTPError:
            pass  # keep vehicle identity even if stats are unavailable

        # Current driver assignment, falling back to the static assignment
        driver_name = None
        try:
            resp = await client.get(
                "/fleet/driver-vehicle-assignments",
                params={"filterBy": "vehicles", "vehicleIds": vehicle_id},
            )
            resp.raise_for_status()
            assignments = resp.json().get("data", [])
            if assignments:
                driver_name = (assignments[0].get("driver") or {}).get("name")
        except httpx.HTTPError:
            pass
        if not driver_name:
            driver_name = (vehicle.get("staticAssignedDriver") or {}).get("name")

        # Full model including year: "YEAR MAKE MODEL"
        model = " ".join(
            str(part)
            for part in [vehicle.get("year"), vehicle.get("make"), vehicle.get("model")]
            if part
        ) or "Unknown"

        return {
            "driver_name": driver_name or "Unassigned",
            "location": location,
            "model": model,
            "fuel_percentage": fuel,
            "latitude": latitude,
            "longitude": longitude,
        }


async def _fetch_generic(mc: MotorCarrier, truck_number: str) -> dict:
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            f"{mc.api_endpoint.rstrip('/')}/trucks/{truck_number}",
            headers={"Authorization": f"Bearer {mc.api_key}"},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "driver_name": data["driver_name"],
            "location": data["location"],
            "model": data["model"],
            "fuel_percentage": float(data["fuel_percentage"]),
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
        }


async def fetch_truck_telemetry(mc: MotorCarrier, truck_number: str) -> dict:
    try:
        if "samsara" in (mc.api_endpoint or "").lower():
            return await _fetch_samsara(mc, truck_number)
        return await _fetch_generic(mc, truck_number)
    except TruckNotFoundError:
        raise  # real answer from the fleet API — surface it, don't mock it
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        return _mock_telemetry(truck_number)
