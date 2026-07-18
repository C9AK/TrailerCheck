"""R25: real-time alert stream (Server-Sent Events).

Every logged-in dashboard holds one EventSource connection here; the hazmat
movement monitor broadcasts through the in-process hub and the event reaches
ALL active users immediately. EventSource cannot set an Authorization header,
so the JWT rides in the query string and is verified the same way as the
bearer dependency."""

import asyncio
import json
import uuid

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from app.core.database import SessionLocal
from app.core.security import JWTError, decode_access_token
from app.models import User
from app.services.alerts import hub

router = APIRouter(tags=["alerts"])

KEEPALIVE_SECONDS = 15.0


def _authenticate(token: str) -> None:
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )


@router.get("/api/alerts/stream")
async def stream_alerts(token: str):
    _authenticate(token)
    queue = await hub.subscribe()

    async def event_stream():
        try:
            yield ": connected\n\n"
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SECONDS)
                    yield f"data: {json.dumps(item)}\n\n"
                except asyncio.TimeoutError:
                    # Comment frame keeps proxies/load balancers from closing
                    # the idle connection.
                    yield ": keepalive\n\n"
        finally:
            await hub.unsubscribe(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # never buffer SSE behind nginx
        },
    )
