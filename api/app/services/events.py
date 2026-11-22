from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator


class CafeEventBus:
    """Lightweight in-process pub/sub for real-time SSE updates across customer and staff screens."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}

    def publish(self, cafe_id: str, event_type: str, payload: dict[str, Any]) -> None:
        queues = self._subscribers.get(cafe_id)
        if not queues:
            return
        message = {"type": event_type, "cafeId": cafe_id, "payload": payload}
        for q in list(queues):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass

    async def subscribe(self, cafe_id: str) -> AsyncGenerator[str, None]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=64)
        self._subscribers.setdefault(cafe_id, set()).add(queue)
        try:
            yield f"event: connected\ndata: {json.dumps({'cafeId': cafe_id})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=20.0)
                    yield f"event: {msg['type']}\ndata: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self._subscribers.get(cafe_id, set()).discard(queue)


event_bus = CafeEventBus()
