import json
from contextlib import suppress
from uuid import uuid4

from aiokafka import AIOKafkaConsumer

from ..core.config import settings
from ..core.database import SessionLocal
from ..models.schemas import StreamEvent
from .repository import upsert_stream_event
from .stream_manager import stream_manager


class EventConsumer:
    """Kafka consumer boundary for production event ingestion."""

    def __init__(self) -> None:
        self.consumer: AIOKafkaConsumer | None = None

    async def start(self) -> None:
        self.consumer = AIOKafkaConsumer(
            settings.kafka_events_topic,
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id="enterprise-ai-ops-hub",
            enable_auto_commit=True,
        )
        await self.consumer.start()

    async def stop(self) -> None:
        if self.consumer:
            await self.consumer.stop()

    async def consume_forever(self) -> None:
        if not self.consumer:
            await self.start()
        assert self.consumer is not None
        async for message in self.consumer:
            with suppress(json.JSONDecodeError, KeyError, Exception):
                payload = json.loads(message.value.decode("utf-8"))
                event = StreamEvent(
                    id=payload.get("id", f"evt_{uuid4().hex[:10]}"),
                    tenant_id=payload["tenant_id"],
                    topic=payload["topic"],
                    severity=payload["severity"],
                    summary=payload["summary"],
                    assigned_agent_id=payload["assigned_agent_id"],
                    confidence=float(payload.get("confidence", 0.75)),
                )
                with SessionLocal() as db:
                    upsert_stream_event(db, event)
                await stream_manager.broadcast(event.tenant_id, event.model_dump())
