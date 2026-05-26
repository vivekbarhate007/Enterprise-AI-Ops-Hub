import asyncio
import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from .api.routes import router
from .core.config import settings
from .core.database import SessionLocal, create_database
from .core.rate_limit import limiter
from .core.telemetry import setup_telemetry
from .services.readiness import readiness_report
from .services.repository import seed_database


logger = logging.getLogger(__name__)


def initialize_app_data() -> None:
    create_database()
    with SessionLocal() as db:
        seed_database(db)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_app_data()

    kafka_task: asyncio.Task | None = None
    consumer = None
    try:
        from .services.kafka_consumer import EventConsumer

        consumer = EventConsumer()
        await consumer.start()
        kafka_task = asyncio.create_task(consumer.consume_forever())
        logger.info("Kafka consumer started on topic %s", settings.kafka_events_topic)
    except Exception as exc:
        logger.warning("Kafka not available (%s) - running without event consumer.", exc)

    try:
        yield
    finally:
        if kafka_task:
            kafka_task.cancel()
            try:
                await kafka_task
            except asyncio.CancelledError:
                pass
        if consumer:
            await consumer.stop()


app = FastAPI(
    title="Enterprise AI Ops Hub API",
    version="1.0.0",
    description="Tenant-aware API for AI agents, RAG, streaming events, approvals, and observability.",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
setup_telemetry(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "enterprise-ai-ops-hub"}


@app.get("/ready")
async def ready() -> dict[str, object]:
    with SessionLocal() as db:
        return readiness_report(db)
