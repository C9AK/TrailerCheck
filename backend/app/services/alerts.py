"""R25: in-process broadcast hub for real-time alerts.

The hazmat movement monitor publishes here; every connected SSE client
(GET /api/alerts/stream) holds a subscriber queue. Single-process design —
matches the current deployment (one uvicorn worker on Render/LAN).
"""

import asyncio
from datetime import datetime, timezone


class AlertHub:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        async with self._lock:
            self._subscribers.discard(queue)

    async def broadcast(self, payload: dict) -> None:
        payload = {**payload, "created_at": datetime.now(timezone.utc).isoformat()}
        async with self._lock:
            for queue in self._subscribers:
                try:
                    queue.put_nowait(payload)
                except asyncio.QueueFull:
                    pass  # slow/stalled client — drop rather than block the monitor


hub = AlertHub()
