"""R25: Samsara movement watch for hazmat loads.

UGL does not haul hazmat. While any ACTIVE ticket has is_hazmat=True, this
background task tracks the truck's live GPS speed through the Samsara Fleet
API and broadcasts a global alert (SSE hub -> every logged-in user) the
moment the truck starts moving.

Latency design: the loop runs back-to-back — each cycle is paced ONLY by the
awaited Samsara HTTP round-trip (no fixed wait timer between polls), so a
movement is caught within one network round-trip. The only sleeps are outside
the hot path: a 1s idle nap when there is nothing hazmat to watch (avoids a
100% CPU spin on the local DB) and an error backoff honoring 429 Retry-After
so a rate-limited key recovers instead of hot-spinning.
"""

import asyncio

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.database import SessionLocal
from app.models import MotorCarrier, PickupTicket, TicketState
from app.services.alerts import hub

# A parked truck with GPS jitter can read ~1-2 mph; above this it is moving.
MOVEMENT_THRESHOLD_MPH = 5.0
# Re-alert for the same ticket only after the truck has stopped again, or at
# most every 5 minutes while it keeps rolling (continuous warning, no spam).
REALERT_SECONDS = 300
IDLE_SLEEP_SECONDS = 1.0
ERROR_BACKOFF_SECONDS = 5.0

# vehicle-id cache: (mc_id, normalized truck number) -> Samsara vehicle id
_vehicle_ids: dict[tuple[str, str], str] = {}
# ticket_id -> monotonic time of the last alert (movement episode tracking)
_last_alert_at: dict[str, float] = {}


def _monitored_tickets(db: Session) -> list[dict]:
    """Hazmat tickets still in play (same 'active' semantics as the boards:
    not dropped; APPROVED only counts while its scale chase is unfinished)."""
    tickets = (
        db.scalars(
            select(PickupTicket)
            .options(joinedload(PickupTicket.motor_carrier))
            .where(
                PickupTicket.is_hazmat.is_(True),
                PickupTicket.is_dropped.is_(False),
                or_(
                    PickupTicket.state != TicketState.APPROVED,
                    (PickupTicket.needs_scale.is_(True))
                    & (PickupTicket.scale_ticket_received.is_(False)),
                ),
            )
        )
        .unique()
        .all()
    )
    rows = []
    for t in tickets:
        mc: MotorCarrier = t.motor_carrier
        if "samsara" not in (mc.api_endpoint or "").lower() or not mc.api_key:
            continue  # no live telematics for this MC — nothing to watch
        rows.append(
            {
                "ticket_id": str(t.id),
                "truck_number": t.truck_number,
                "mc_id": str(mc.id),
                "mc_name": mc.name,
                "api_key": mc.api_key,
            }
        )
    return rows


async def _lookup_vehicle_id(
    client: httpx.AsyncClient, api_key: str, truck_number: str
) -> str | None:
    """Find the Samsara vehicle id by name (whitespace-normalized), same
    matching rule as the telemetry proxy."""
    wanted = " ".join(truck_number.split()).lower()
    headers = {"Authorization": f"Bearer {api_key}"}
    after: str | None = None
    for _ in range(10):
        params: dict = {"limit": 512}
        if after:
            params["after"] = after
        resp = await client.get("/fleet/vehicles", params=params, headers=headers)
        resp.raise_for_status()
        body = resp.json()
        for vehicle in body.get("data", []):
            if " ".join(str(vehicle.get("name", "")).split()).lower() == wanted:
                return str(vehicle["id"])
        pagination = body.get("pagination", {})
        if not pagination.get("hasNextPage"):
            return None
        after = pagination.get("endCursor")
    return None


async def _poll_group(
    client: httpx.AsyncClient, api_key: str, rows: list[dict]
) -> None:
    """One stats request per MC covers ALL its watched hazmat trucks."""
    headers = {"Authorization": f"Bearer {api_key}"}

    by_vehicle: dict[str, dict] = {}
    for row in rows:
        cache_key = (row["mc_id"], " ".join(row["truck_number"].split()).lower())
        vehicle_id = _vehicle_ids.get(cache_key)
        if vehicle_id is None:
            vehicle_id = await _lookup_vehicle_id(client, api_key, row["truck_number"])
            if vehicle_id is None:
                continue  # truck not in this fleet — skip until it appears
            _vehicle_ids[cache_key] = vehicle_id
        by_vehicle[vehicle_id] = row

    if not by_vehicle:
        return

    resp = await client.get(
        "/fleet/vehicles/stats",
        params={"vehicleIds": ",".join(by_vehicle), "types": "gps"},
        headers=headers,
    )
    resp.raise_for_status()

    loop_now = asyncio.get_running_loop().time()
    for stats in resp.json().get("data", []):
        row = by_vehicle.get(str(stats.get("id")))
        if row is None:
            continue
        gps = stats.get("gps") or {}
        speed = gps.get("speedMilesPerHour")
        if speed is None:
            continue
        speed = float(speed)
        ticket_id = row["ticket_id"]

        if speed <= MOVEMENT_THRESHOLD_MPH:
            # Truck stopped — arm the alert for the next movement episode.
            _last_alert_at.pop(ticket_id, None)
            continue

        last = _last_alert_at.get(ticket_id)
        if last is not None and loop_now - last < REALERT_SECONDS:
            continue
        _last_alert_at[ticket_id] = loop_now

        location = (gps.get("reverseGeo") or {}).get("formattedLocation")
        await hub.broadcast(
            {
                "type": "hazmat_movement",
                "ticket_id": ticket_id,
                "truck_number": row["truck_number"],
                "mc_name": row["mc_name"],
                "speed_mph": round(speed),
                "location": location,
                "message": (
                    f"HAZMAT ALERT — truck {row['truck_number']} ({row['mc_name']}) "
                    f"is MOVING at {round(speed)} mph"
                    + (f" near {location}" if location else "")
                    + ". UGL does not haul hazmat — stop this truck NOW."
                ),
            }
        )


async def hazmat_monitor_loop() -> None:
    """Continuous watch. Runs for the lifetime of the app; cancelled on
    shutdown by the lifespan handler."""
    async with httpx.AsyncClient(
        base_url="https://api.samsara.com", timeout=10.0
    ) as client:
        while True:
            try:
                rows = await asyncio.to_thread(_run_db_query)
                if not rows:
                    # Nothing hazmat in play — don't spin the DB at 100% CPU.
                    await asyncio.sleep(IDLE_SLEEP_SECONDS)
                    continue

                groups: dict[str, list[dict]] = {}
                for row in rows:
                    groups.setdefault(row["api_key"], []).append(row)
                # Immediately re-poll: pacing comes from the HTTP round-trips
                # themselves, not a timer — movement is caught instantly.
                for api_key, group in groups.items():
                    await _poll_group(client, api_key, group)
            except asyncio.CancelledError:
                raise
            except httpx.HTTPStatusError as exc:
                retry_after = ERROR_BACKOFF_SECONDS
                if exc.response.status_code == 429:
                    try:
                        retry_after = float(
                            exc.response.headers.get("Retry-After", retry_after)
                        )
                    except ValueError:
                        pass
                await asyncio.sleep(retry_after)
            except Exception as exc:  # noqa: BLE001 — the watch must survive anything
                print(f"hazmat monitor: transient error, retrying — {exc!r}")
                await asyncio.sleep(ERROR_BACKOFF_SECONDS)


def _run_db_query() -> list[dict]:
    with SessionLocal() as db:
        return _monitored_tickets(db)
