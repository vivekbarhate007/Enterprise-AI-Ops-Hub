import asyncio
from collections import defaultdict

from fastapi import WebSocket


class StreamManager:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def connect(self, tenant_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[tenant_id].append(websocket)

    async def disconnect(self, tenant_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections.get(tenant_id, [])
            if websocket in connections:
                connections.remove(websocket)

    async def broadcast(self, tenant_id: str, payload: dict) -> None:
        dead: list[WebSocket] = []
        async with self._lock:
            connections = list(self._connections.get(tenant_id, []))

        for websocket in connections:
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.append(websocket)

        for websocket in dead:
            await self.disconnect(tenant_id, websocket)


stream_manager = StreamManager()
