# Enterprise AI Ops Hub — Codex Implementation Brief

You are working on a full-stack enterprise SaaS project called **Enterprise AI Ops Hub**.
This document is a complete, ordered set of tasks for you to implement, test, and verify.
Work through each task in order. After each task, run the verification commands shown.
Do NOT move to the next task until verification passes.

---

## Project Layout

```
enterprise-ai-ops-hub/
  backend/
    app/
      main.py                  # FastAPI app + lifespan
      core/config.py           # Pydantic settings
      core/database.py         # SQLAlchemy engine
      api/routes.py            # All HTTP + WebSocket routes
      models/tables.py         # SQLAlchemy ORM models
      models/schemas.py        # Pydantic response schemas
      services/
        agent_runtime.py       # Agent orchestration boundary
        auth.py                # JWT + RBAC helpers
        embeddings.py          # Text chunking + embedding
        integrations.py        # Slack / GitHub / PagerDuty
        kafka_consumer.py      # Kafka consumer scaffold
        llm_providers.py       # Local / OpenAI / Anthropic / Groq
        passwords.py           # bcrypt helpers
        rag.py                 # Document ingest + retrieval
        readiness.py           # /ready health check
        repository.py          # All database read/write
    migrations/                # Alembic versions
    tests/test_api.py          # Pytest suite
    requirements.txt
  frontend/
    src/
      App.tsx                  # 3600-line monolith (split in task 10)
      data.ts
      styles.css
    package.json
  infra/
    docker/
    k8s/
    terraform/
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  .env
```

---

## How to run the project locally

```bash
# Terminal 1 — backend
source .venv/bin/activate
uvicorn backend.app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev

# Run backend tests
.venv/bin/python -m pytest backend/tests -v

# Run frontend build check
npm --prefix frontend run build
```

---

## Task 1 — Guard against weak JWT secret

**Problem:** `config.py` defaults `jwt_secret` to the string `"replace-me"`.
In any non-development environment this is an open security hole — anyone can forge tokens.

**What to do:**

1. Open `backend/app/core/config.py`.
2. Add a `model_validator` that raises a `ValueError` if `app_env != "development"` and `jwt_secret == "replace-me"`.
3. Also add a startup warning log (not an exception) when the secret is the default value even in development.

**Implementation:**

```python
# backend/app/core/config.py
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import logging

logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    app_env: str = "development"
    jwt_issuer: str = "enterprise-ai-ops-hub"
    jwt_secret: str = "replace-me"
    # ... all other existing fields unchanged ...

    @model_validator(mode="after")
    def _validate_jwt_secret(self) -> "Settings":
        if self.jwt_secret == "replace-me":
            if self.app_env != "development":
                raise ValueError(
                    "JWT_SECRET must be set to a strong random value in non-development environments. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
                )
            logger.warning(
                "JWT_SECRET is using the insecure default 'replace-me'. "
                "This is only acceptable in development. Set a real secret in .env before deploying."
            )
        return self

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
```

**Verification:**
```bash
# Should start fine in development with default secret (warning in logs)
APP_ENV=development uvicorn backend.app.main:app --port 8001 &
sleep 2 && curl -s http://localhost:8001/health | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'; print('PASS')"
kill %1

# Should refuse to start in production with default secret
APP_ENV=production python3 -c "
import os; os.environ['APP_ENV']='production'
try:
    from backend.app.core.config import Settings
    Settings()
    print('FAIL — should have raised')
except ValueError as e:
    print('PASS:', e)
"
```

---

## Task 2 — Fix double initialization in main.py

**Problem:** `initialize_app_data()` is called at module import time AND inside the lifespan context manager. The database is seeded twice on every startup.

**What to do:**

Open `backend/app/main.py`. Remove the bare `initialize_app_data()` call at module level. Keep only the one inside `lifespan`.

**Before:**
```python
def initialize_app_data() -> None:
    create_database()
    with SessionLocal() as db:
        seed_database(db)

initialize_app_data()   # <-- REMOVE THIS LINE

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_app_data()   # <-- keep only this one
    yield
```

**After:**
```python
def initialize_app_data() -> None:
    create_database()
    with SessionLocal() as db:
        seed_database(db)

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_app_data()
    yield
```

**Verification:**
```bash
.venv/bin/python -m pytest backend/tests/test_api.py::test_health -v
```
Should pass and logs should show seed running exactly once.

---

## Task 3 — Fix duplicate agent run IDs

**Problem:** `agent_runtime.py` generates run IDs as `f"run_{event.id}"`. Running the same event twice produces the same ID, which causes a database primary key collision.

**What to do:**

Open `backend/app/services/agent_runtime.py`. Replace the hardcoded ID with a UUID-based ID.

**Change:**
```python
from uuid import uuid4

# inside the run() method, change:
return AgentRun(
    id=f"run_{uuid4().hex[:12]}",   # was: f"run_{event.id}"
    ...
)
```

Also fix the hardcoded latency. Measure real wall-clock time:

```python
import time

def run(self, event: StreamEvent) -> AgentRun:
    start = time.monotonic()
    # ... existing logic ...
    latency_ms = int((time.monotonic() - start) * 1000)

    return AgentRun(
        id=f"run_{uuid4().hex[:12]}",
        latency_ms=max(latency_ms, 1),  # never 0
        ...
    )
```

**Verification:**
```bash
.venv/bin/python -m pytest backend/tests/test_api.py::test_agent_run_is_persisted -v
# Also manually verify running same event twice does not crash:
python3 -c "
import os; os.environ['DATABASE_URL'] = 'sqlite:///./verify_task3.db'
from fastapi.testclient import TestClient
from backend.app.main import app
client = TestClient(app)
headers = {'Authorization': 'Bearer ' + client.post('/api/v1/auth/login', json={'email':'admin@aiopshub.local','password':'admin123'}).json()['access_token']}
r1 = client.post('/api/v1/events/evt_1092/run', headers=headers)
r2 = client.post('/api/v1/events/evt_1092/run', headers=headers)
assert r1.status_code == 200
assert r2.status_code == 200
assert r1.json()['id'] != r2.json()['id'], 'IDs must differ'
print('PASS — two runs produced different IDs:', r1.json()['id'], r2.json()['id'])
import os; os.remove('verify_task3.db')
"
```

---

## Task 4 — Make LLM providers async (fix event loop blocking)

**Problem:** All three LLM provider `complete()` methods use `httpx.post()` which is synchronous and blocks the FastAPI event loop while waiting for external API responses. Under load this stalls all concurrent requests.

**What to do:**

Rewrite `backend/app/services/llm_providers.py` so every provider has an `async def complete()` using `httpx.AsyncClient`. The `LLMRouter.complete()` method becomes `async def complete()`.

Update all callers:
- `backend/app/services/agent_runtime.py` — `AgentRuntime.run()` becomes `async def run()`
- `backend/app/services/rag.py` — `RagService.answer()` becomes `async def answer()`
- `backend/app/api/routes.py` — all route handlers that call these become `await`-based

**Key pattern for each provider:**

```python
class OpenAIProvider:
    name = "openai"
    model = "gpt-4o-mini"

    async def complete(self, prompt: str) -> LLMCompletion:
        if not settings.openai_api_key:
            return await LocalProvider().complete(prompt)
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": "You are an enterprise AI operations assistant."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.2,
                },
            )
        response.raise_for_status()
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        return LLMCompletion(provider=self.name, model=self.model, content=content, token_cost_cents=1)
```

Apply the same pattern to `AnthropicProvider`, `GroqProvider`, and `LocalProvider` (LocalProvider can stay sync but wrap it with `asyncio.to_thread` or just make it `async def` since it does no I/O).

**In routes.py**, update callers:
```python
@router.post("/llm/complete", response_model=ChatResponse)
async def complete(payload: ChatRequest, user: AuthUser = Depends(get_current_user)) -> ChatResponse:
    completion = await llm_router.complete(payload.prompt, provider=payload.provider)  # add await
    ...
```

**Verification:**
```bash
.venv/bin/python -m pytest backend/tests/test_api.py::test_llm_provider_local_fallback -v
.venv/bin/python -m pytest backend/tests/test_api.py -v   # full suite must still pass
```

---

## Task 5 — Replace fake embeddings with real semantic embeddings

**Problem:** The current `embed_text()` function in `backend/app/services/embeddings.py` is a SHA256-based hash tokenizer. It has zero semantic meaning. "database crash" and "server failure" get similarity score near 0 even though they mean the same thing.

**What to do:**

1. Add `sentence-transformers` to `backend/requirements.txt`:
   ```
   sentence-transformers>=3.0.0
   ```

2. Rewrite `backend/app/services/embeddings.py`:

```python
import math
import re
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

CHUNK_SIZE_WORDS = 90
_MODEL_NAME = "all-MiniLM-L6-v2"   # 384-dim, CPU-friendly, ~80MB


@lru_cache(maxsize=1)
def _get_model() -> "SentenceTransformer":
    from sentence_transformers import SentenceTransformer  # lazy import
    return SentenceTransformer(_MODEL_NAME)


def chunk_text(text: str, *, max_words: int = CHUNK_SIZE_WORDS) -> list[str]:
    words = text.split()
    if not words:
        return []
    chunks: list[str] = []
    for start in range(0, len(words), max_words):
        chunks.append(" ".join(words[start : start + max_words]))
    return chunks


def embed_text(text: str) -> list[float]:
    model = _get_model()
    vector = model.encode(text, normalize_embeddings=True)
    return [round(float(v), 6) for v in vector]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_l = math.sqrt(sum(v * v for v in left)) or 1.0
    norm_r = math.sqrt(sum(v * v for v in right)) or 1.0
    return dot / (norm_l * norm_r)
```

3. Because the embedding dimension changes from 128 to 384, any existing `embedding_json` stored in the DB is now invalid. Add a migration note and in `repository.py`'s `seed_database()`, ensure existing chunks are re-embedded on startup if their dimension is 128.

**Verification:**
```bash
pip install sentence-transformers

python3 -c "
from backend.app.services.embeddings import embed_text, cosine_similarity
v1 = embed_text('database pool saturation causes checkout latency')
v2 = embed_text('server connection pool is full causing slow responses')
v3 = embed_text('the weather is sunny today')
sim_related = cosine_similarity(v1, v2)
sim_unrelated = cosine_similarity(v1, v3)
print(f'Related similarity:   {sim_related:.3f}  (should be > 0.5)')
print(f'Unrelated similarity: {sim_unrelated:.3f}  (should be < 0.4)')
assert sim_related > 0.5, 'FAIL — related sentences not similar'
assert sim_related > sim_unrelated, 'FAIL — unrelated should score lower'
print('PASS')
"
```

---

## Task 6 — Wire agent runtime to actually use RAG

**Problem:** `agent_runtime.py`'s `run()` method returns two hardcoded sources (`"Checkout Latency Runbook"` and `"Postgres Pool Saturation RCA"`) regardless of the input event or what documents exist in the database. The RAG service is never called.

**What to do:**

Rewrite `AgentRuntime.run()` to:
1. Accept a `db: Session` parameter
2. Call `RagService().retrieve(db, tenant_id=event.tenant_id, query=event.summary)` to get real sources
3. Pass those sources to the LLM prompt as grounded context
4. Build `sources` from the actual retrieval results

```python
# backend/app/services/agent_runtime.py
import time
from uuid import uuid4

from sqlalchemy.orm import Session

from ..models.schemas import AgentRun, RagSource, StreamEvent
from .llm_providers import LLMRouter
from .rag import RagService


class AgentRuntime:
    def __init__(self, router: LLMRouter | None = None, rag: RagService | None = None) -> None:
        self.router = router or LLMRouter()
        self.rag = rag or RagService()

    async def run(self, event: StreamEvent, db: Session) -> AgentRun:
        start = time.monotonic()

        # Real RAG retrieval
        retrieved = self.rag.retrieve(db, tenant_id=event.tenant_id, query=event.summary, limit=4)
        sources = [
            RagSource(
                title=source.title,
                source_type=source.source_type,
                relevance=round(source.score, 3),
                chunk_count=1,
            )
            for source in retrieved
        ]

        context = "\n".join(f"- {s.title}: {r.text}" for s, r in zip(sources, retrieved))
        prompt = (
            f"You are an enterprise AI operations assistant.\n"
            f"Event severity: {event.severity}\n"
            f"Event summary: {event.summary}\n\n"
            f"Relevant knowledge:\n{context}\n\n"
            "Recommend a safe, specific enterprise operations action. Cite the knowledge sources."
        )

        approval_required = event.severity.lower() in {"critical", "high"}
        provider = "anthropic" if "incident" in event.assigned_agent_id else "openai"
        completion = await self.router.complete(prompt, provider=provider)

        latency_ms = max(int((time.monotonic() - start) * 1000), 1)

        return AgentRun(
            id=f"run_{uuid4().hex[:12]}",
            tenant_id=event.tenant_id,
            agent_id=event.assigned_agent_id,
            event_id=event.id,
            latency_ms=latency_ms,
            token_cost_cents=completion.token_cost_cents,
            confidence=event.confidence,
            sources=sources,
            approval_required=approval_required,
            recommended_action=completion.content,
        )
```

Update the route in `routes.py` that calls `runtime.run()`:
```python
run = await runtime.run(event, db)   # pass db, add await
```

**Verification:**
```bash
# Upload a test document, then run an agent and verify the source comes from the upload
python3 -c "
import os; os.environ['DATABASE_URL'] = 'sqlite:///./verify_task6.db'
from fastapi.testclient import TestClient
from backend.app.main import app
client = TestClient(app)
headers = {'Authorization': 'Bearer ' + client.post('/api/v1/auth/login', json={'email':'admin@aiopshub.local','password':'admin123'}).json()['access_token']}

# Upload a real document
client.post('/api/v1/documents/upload', headers=headers,
    files={'file': ('runbook.txt', b'Database connection pool saturation causes high checkout latency. Restart workers with SRE approval.', 'text/plain')},
    data={'title': 'Pool Saturation Runbook'})

# Run the agent
r = client.post('/api/v1/events/evt_1092/run', headers=headers)
assert r.status_code == 200
body = r.json()
print('Sources returned:', [s['title'] for s in body['sources']])
assert any('Pool Saturation' in s['title'] or 'Runbook' in s['title'] for s in body['sources']), 'FAIL — RAG not used'
print('PASS — agent used RAG retrieval')
import os; os.remove('verify_task6.db')
"
```

---

## Task 7 — Real WebSocket push for live events

**Problem:** The `/stream` WebSocket endpoint sends a snapshot of existing events and immediately closes. New events posted after connection are never delivered to connected clients.

**What to do:**

1. Create a connection manager in `backend/app/services/stream_manager.py`:

```python
# backend/app/services/stream_manager.py
import asyncio
from collections import defaultdict
from fastapi import WebSocket


class StreamManager:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, tenant_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[tenant_id].append(websocket)

    def disconnect(self, tenant_id: str, websocket: WebSocket) -> None:
        connections = self._connections.get(tenant_id, [])
        if websocket in connections:
            connections.remove(websocket)

    async def broadcast(self, tenant_id: str, payload: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._connections.get(tenant_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(tenant_id, ws)


stream_manager = StreamManager()
```

2. Update `routes.py` to use the manager. The WebSocket handler now stays open waiting for new messages:

```python
from ..services.stream_manager import stream_manager

@router.websocket("/stream")
async def stream(websocket: WebSocket) -> None:
    tenant_id = websocket.query_params.get("tenant_id", settings.demo_tenant_id)
    token = websocket.query_params.get("token", "")

    with SessionLocal() as db:
        user = get_user_from_token(db, token)
        if not user:
            await websocket.close(code=1008, reason="Authentication required")
            return
        try:
            require_tenant_access(user, tenant_id)
        except HTTPException:
            await websocket.close(code=1008, reason="Tenant access denied")
            return
        # Send existing events as initial snapshot
        initial_events = list_stream_events(db, tenant_id=tenant_id)

    await stream_manager.connect(tenant_id, websocket)

    try:
        for event in initial_events:
            await websocket.send_json(event.model_dump())

        # Keep the connection alive until the client disconnects
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})  # keepalive
    except WebSocketDisconnect:
        pass
    finally:
        stream_manager.disconnect(tenant_id, websocket)
```

3. In the `create_event` route, broadcast the new event to all connected clients:

```python
from ..services.stream_manager import stream_manager

@router.post("/events", response_model=StreamEvent, status_code=201)
async def create_event(...) -> StreamEvent:
    ...
    created = upsert_stream_event(db, event)
    # Broadcast to all connected WebSocket clients for this tenant
    await stream_manager.broadcast(tenant_id, created.model_dump())
    ...
    return created
```

**Verification:**
```bash
.venv/bin/python -m pytest backend/tests/test_api.py::test_websocket_streams_events -v
# Also verify the test suite still passes fully:
.venv/bin/python -m pytest backend/tests -v
```

---

## Task 8 — Start Kafka consumer in lifespan (with graceful fallback)

**Problem:** `kafka_consumer.py` defines an `EventConsumer` class but it is never started anywhere. The Kafka story is completely dead at runtime.

**What to do:**

Update `backend/app/main.py` lifespan to start the consumer in a background task, with a graceful fallback if Kafka is not available:

```python
import asyncio
import logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_app_data()

    # Start Kafka consumer in background — fail gracefully if broker not available
    kafka_task: asyncio.Task | None = None
    try:
        from .services.kafka_consumer import EventConsumer
        consumer = EventConsumer()
        await consumer.start()
        kafka_task = asyncio.create_task(consumer.consume_forever())
        logger.info("Kafka consumer started on topic %s", settings.kafka_events_topic)
    except Exception as exc:
        logger.warning("Kafka not available (%s) — running without event consumer.", exc)

    yield

    if kafka_task:
        kafka_task.cancel()
        try:
            await kafka_task
        except asyncio.CancelledError:
            pass
```

Also update `kafka_consumer.py` to handle connection errors gracefully:

```python
async def start(self) -> None:
    self.consumer = AIOKafkaConsumer(
        settings.kafka_events_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id="enterprise-ai-ops-hub",
        enable_auto_commit=True,
    )
    await self.consumer.start()   # raises if broker unreachable

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
            # Broadcast to connected WebSocket clients
            from .stream_manager import stream_manager
            await stream_manager.broadcast(event.tenant_id, event.model_dump())
```

**Verification:**
```bash
# Server should start without Kafka running
uvicorn backend.app.main:app --port 8002 &
sleep 3
curl -s http://localhost:8002/health | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'; print('PASS — server starts without Kafka')"
kill %1
```

---

## Task 9 — Add rate limiting to login endpoint

**Problem:** The `/auth/login` endpoint has no brute-force protection. Any attacker can try millions of passwords.

**What to do:**

1. Add `slowapi` to `backend/requirements.txt`:
   ```
   slowapi>=0.1.9
   ```

2. Update `backend/app/main.py`:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

3. Update the login route in `routes.py`:

```python
from fastapi import Request
from ..main import limiter   # or pass limiter via dependency

@router.post("/auth/login", response_model=AuthSession)
@limiter.limit("10/minute")
async def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> AuthSession:
    return authenticate_user(db, payload)
```

**Verification:**
```bash
python3 -c "
import time
from fastapi.testclient import TestClient
import os; os.environ['DATABASE_URL'] = 'sqlite:///./verify_task9.db'
from backend.app.main import app
client = TestClient(app)
# Send 11 failed login attempts
results = [client.post('/api/v1/auth/login', json={'email': 'x@x.com', 'password': 'wrong'}).status_code for _ in range(11)]
print('Status codes:', results)
assert 429 in results, 'FAIL — rate limit not triggered after 10 attempts'
print('PASS — rate limit triggered at attempt:', results.index(429) + 1)
import os; os.remove('verify_task9.db')
"
```

---

## Task 10 — Add pagination to all list endpoints

**Problem:** Every list endpoint returns all rows. With large datasets this will OOM the server.

**What to do:**

Add `limit: int = Query(default=50, le=500)` and `offset: int = Query(default=0, ge=0)` to every list route and pass them to the repository layer.

**Routes to update:** `/agents`, `/events`, `/runs`, `/approvals`, `/documents`, `/audit-logs`

**Example pattern:**
```python
@router.get("/events", response_model=list[StreamEvent])
async def events(
    tenant_id: str = Depends(default_tenant_id),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> list[StreamEvent]:
    require_tenant_access(user, tenant_id)
    return list_stream_events(db, tenant_id=tenant_id, limit=limit, offset=offset)
```

**Repository changes** — add `limit` and `offset` to each list function:
```python
def list_stream_events(db: Session, tenant_id: str, *, limit: int = 50, offset: int = 0) -> list[StreamEvent]:
    records = db.execute(
        select(EventRecord)
        .where(EventRecord.tenant_id == tenant_id)
        .order_by(EventRecord.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).scalars().all()
    return [stream_event_from_record(r) for r in records]
```

Apply this same pattern to `list_agents`, `list_agent_runs`, `list_approvals`, `list_documents`, `list_audit_logs`.

**Verification:**
```bash
python3 -c "
import os; os.environ['DATABASE_URL'] = 'sqlite:///./verify_task10.db'
from fastapi.testclient import TestClient
from backend.app.main import app
client = TestClient(app)
headers = {'Authorization': 'Bearer ' + client.post('/api/v1/auth/login', json={'email':'admin@aiopshub.local','password':'admin123'}).json()['access_token']}
r = client.get('/api/v1/events', headers=headers, params={'limit': 2, 'offset': 0})
assert r.status_code == 200
assert len(r.json()) <= 2, 'FAIL — limit not respected'
print('PASS — pagination works, got', len(r.json()), 'events')
import os; os.remove('verify_task10.db')
"
```

---

## Task 11 — Add PDF document ingestion support

**Problem:** Documents can only be uploaded as `.txt` or `.md` files. Enterprise runbooks are almost always PDFs.

**What to do:**

1. Add `pypdf>=4.0.0` to `backend/requirements.txt`.

2. Update `backend/app/api/routes.py` document upload handler to detect and extract PDF text:

```python
import io

@router.post("/documents/upload", response_model=DocumentUploadResult, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> DocumentUploadResult:
    require_tenant_access(user, tenant_id, {"Admin", "SRE"})
    raw = await file.read()
    filename = file.filename or "upload"
    extension = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    if extension == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            content = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not parse PDF: {exc}") from exc
    else:
        content = raw.decode("utf-8", errors="ignore")

    if not content.strip():
        raise HTTPException(status_code=400, detail="Document is empty or not text-readable")

    # Validate allowed types
    allowed_extensions = {"txt", "md", "markdown", "pdf"}
    if extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '.{extension}'. Allowed: {allowed_extensions}")

    result = rag_service.ingest_text(
        db,
        tenant_id=tenant_id,
        title=title or filename,
        source_type=extension,
        content=content,
    )
    record_audit(db, tenant_id=tenant_id, actor=user.email, action="document.uploaded",
                 target=result.id, status="indexed", detail=f"{result.title} indexed into {result.chunk_count} chunk(s).")
    return result
```

**Verification:**
```bash
pip install pypdf

python3 -c "
# Create a minimal test PDF using pypdf
from pypdf import PdfWriter
import io
writer = PdfWriter()
page = writer.add_blank_page(width=612, height=792)
pdf_bytes = io.BytesIO()
writer.write(pdf_bytes)
pdf_bytes.seek(0)
print('PDF creation works. Manual test: upload a real PDF via the UI or curl.')
print('PASS')
"

# Also run type-validation test
python3 -c "
import os; os.environ['DATABASE_URL'] = 'sqlite:///./verify_task11.db'
from fastapi.testclient import TestClient
from backend.app.main import app
client = TestClient(app)
headers = {'Authorization': 'Bearer ' + client.post('/api/v1/auth/login', json={'email':'admin@aiopshub.local','password':'admin123'}).json()['access_token']}
r = client.post('/api/v1/documents/upload', headers=headers,
    files={'file': ('malware.exe', b'MZ\x90\x00', 'application/octet-stream')})
assert r.status_code == 400, f'FAIL — should reject .exe, got {r.status_code}'
print('PASS — .exe correctly rejected with 400')
import os; os.remove('verify_task11.db')
"
```

---

## Task 12 — Split App.tsx into separate component files

**Problem:** `frontend/src/App.tsx` is 3,666 lines. This is the first file any senior engineer opens and it immediately signals unmaintainability.

**What to do:**

Create the following directory structure under `frontend/src/`:

```
frontend/src/
  api/
    client.ts         # apiFetch, apiUrl, apiErrorMessage, parseApiJson
    auth.ts           # login, logout, readStoredAuthSession
  types/
    index.ts          # ALL type definitions (AuthUser, StreamEvent, etc.)
  hooks/
    useAuth.ts        # auth state + login/logout
    useEvents.ts      # loadBackendEvents, createStreamEvent, streamStatus
    useApprovals.ts   # loadApprovals, decideApproval
    useDocuments.ts   # loadIndexedDocuments, uploadDocument, deleteDocument
    useAgentRun.ts    # runSelectedAgent, refreshRunTrace
    useKnowledge.ts   # askKnowledgeBase
    useAdmin.ts       # loadAdminConsole, loadTenants, testIntegration
    useSecurity.ts    # loadSecuritySummary
    useRoi.ts         # loadRoiSummary
    useMarketplace.ts # loadMarketplace, deployTemplate
  views/
    CommandCenter.tsx
    ExecutiveDemo.tsx
    AgentBuilder.tsx
    KnowledgeBase.tsx
    Approvals.tsx
    Streaming.tsx
    Marketplace.tsx
    Roi.tsx
    SecurityCenter.tsx
    AdminConsole.tsx
    Settings.tsx
    Login.tsx
  components/
    Sidebar.tsx
    Topbar.tsx
    TraceDrawer.tsx
    DeployModal.tsx
    MetricGrid.tsx
    OperationalStrip.tsx
  App.tsx              # slim root: wires hooks + renders active view
```

**Implementation rules:**
- `types/index.ts` exports every type that currently lives at the top of `App.tsx`
- `api/client.ts` exports `apiFetch`, `apiUrl`, `apiErrorMessage`, `parseApiJson`, `API_BASE_URLS`
- Each hook returns state + action functions following the exact same signatures the current `App.tsx` uses
- Each view file imports its hook and renders only what that view needs
- `App.tsx` becomes < 150 lines: it composes hooks and renders the active view via a switch or map

**Verification:**
```bash
npm --prefix frontend run build
# Must produce zero TypeScript errors and zero build errors

# Count lines in new App.tsx — it must be under 150 lines
wc -l frontend/src/App.tsx
```

---

## Task 13 — Add streaming LLM responses via SSE

**Problem:** Every LLM completion waits for the full response before returning anything to the user. Enterprise AI tools stream token-by-token output. This is a required UX capability.

**What to do:**

1. Add a new streaming endpoint in `routes.py`:

```python
from fastapi.responses import StreamingResponse
import json

@router.get("/llm/stream")
async def stream_complete(
    prompt: str,
    provider: str = "local",
    user: AuthUser = Depends(get_current_user),
) -> StreamingResponse:
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")

    async def event_generator():
        # For local provider, stream word-by-word
        if provider == "local":
            completion = await llm_router.complete(prompt, provider="local")
            words = completion.content.split()
            for i, word in enumerate(words):
                chunk = word + (" " if i < len(words) - 1 else "")
                yield f"data: {json.dumps({'token': chunk})}\n\n"
                import asyncio; await asyncio.sleep(0.04)  # simulate streaming
            yield f"data: {json.dumps({'done': True})}\n\n"

        # For OpenAI, use real streaming
        elif provider == "openai" and settings.openai_api_key:
            import httpx
            async with httpx.AsyncClient(timeout=60) as client:
                async with client.stream(
                    "POST",
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": True,
                        "temperature": 0.2,
                    },
                ) as response:
                    async for line in response.aiter_lines():
                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                payload = json.loads(line[6:])
                                token = payload["choices"][0]["delta"].get("content", "")
                                if token:
                                    yield f"data: {json.dumps({'token': token})}\n\n"
                            except Exception:
                                pass
            yield f"data: {json.dumps({'done': True})}\n\n"

        else:
            # Fallback: non-streaming local
            completion = await llm_router.complete(prompt, provider="local")
            yield f"data: {json.dumps({'token': completion.content})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

2. In the frontend `KnowledgeBase` view, update the Ask button to use the SSE endpoint and stream tokens into the answer box as they arrive.

**Verification:**
```bash
# Start the backend
uvicorn backend.app.main:app --port 8003 &
sleep 2

# Test with curl (get a token from login first)
TOKEN=$(curl -s -X POST http://localhost:8003/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@aiopshub.local","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -N "http://localhost:8003/api/v1/llm/stream?prompt=explain+checkout+latency&provider=local" \
  -H "Authorization: Bearer $TOKEN" | head -5

kill %1
```

---

## Task 14 — Add OpenTelemetry tracing

**Problem:** There is no distributed tracing. Engineers at large companies evaluate candidates on whether they understand observability at the infrastructure level.

**What to do:**

1. Add to `backend/requirements.txt`:
   ```
   opentelemetry-sdk>=1.24.0
   opentelemetry-instrumentation-fastapi>=0.45b0
   opentelemetry-exporter-otlp-proto-grpc>=1.24.0
   ```

2. Create `backend/app/core/telemetry.py`:

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor


def setup_telemetry(app) -> None:
    resource = Resource(attributes={"service.name": "enterprise-ai-ops-hub"})
    provider = TracerProvider(resource=resource)

    # Console exporter for local dev; swap for OTLP in production
    provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)

    FastAPIInstrumentor.instrument_app(app)


tracer = trace.get_tracer("ai-ops-hub")
```

3. In `main.py`:
```python
from .core.telemetry import setup_telemetry

app = FastAPI(...)
setup_telemetry(app)
```

4. Add manual spans in key service methods:

```python
# In agent_runtime.py
from ..core.telemetry import tracer

async def run(self, event: StreamEvent, db: Session) -> AgentRun:
    with tracer.start_as_current_span("agent.run") as span:
        span.set_attribute("event.id", event.id)
        span.set_attribute("event.severity", event.severity)
        span.set_attribute("tenant.id", event.tenant_id)

        with tracer.start_as_current_span("rag.retrieve"):
            retrieved = self.rag.retrieve(...)

        with tracer.start_as_current_span("llm.complete"):
            completion = await self.router.complete(...)

        span.set_attribute("agent.confidence", event.confidence)
        span.set_attribute("agent.approval_required", approval_required)
        return AgentRun(...)
```

**Verification:**
```bash
pip install opentelemetry-sdk opentelemetry-instrumentation-fastapi

# Start server and check that traces appear in console
uvicorn backend.app.main:app --port 8004 &
sleep 2
TOKEN=$(curl -s -X POST http://localhost:8004/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@aiopshub.local","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -s http://localhost:8004/api/v1/events -H "Authorization: Bearer $TOKEN" > /dev/null
echo "PASS — check console output above for OpenTelemetry span logs"
kill %1
```

---

## Final — Run Complete Verification Suite

After completing all tasks, run the following in order. All must pass.

```bash
# 1. Install any new dependencies
pip install -r backend/requirements.txt

# 2. Full pytest suite
.venv/bin/python -m pytest backend/tests -v --tb=short

# 3. Frontend TypeScript build (zero errors)
npm --prefix frontend run build

# 4. Frontend E2E tests
npm --prefix frontend run e2e

# 5. Readiness check
uvicorn backend.app.main:app --port 8005 &
sleep 3
curl -s http://localhost:8005/ready | python3 -m json.tool
kill %1

# 6. RAG semantic sanity check
python3 -c "
from backend.app.services.embeddings import embed_text, cosine_similarity
v1 = embed_text('database connection pool is saturated')
v2 = embed_text('server is out of database connections')
v3 = embed_text('the stock market closed higher today')
print('Related pair similarity:', round(cosine_similarity(v1, v2), 3), '(want > 0.5)')
print('Unrelated pair similarity:', round(cosine_similarity(v1, v3), 3), '(want < 0.4)')
"

# 7. Verify no duplicate run IDs
python3 -c "
import os; os.environ['DATABASE_URL'] = 'sqlite:///./final_verify.db'
from fastapi.testclient import TestClient
from backend.app.main import app
client = TestClient(app)
h = {'Authorization': 'Bearer ' + client.post('/api/v1/auth/login', json={'email':'admin@aiopshub.local','password':'admin123'}).json()['access_token']}
ids = [client.post('/api/v1/events/evt_1092/run', headers=h).json()['id'] for _ in range(5)]
assert len(set(ids)) == 5, f'FAIL duplicate IDs: {ids}'
print('PASS — all 5 run IDs unique:', ids)
import os; os.remove('final_verify.db')
"

echo "=== ALL VERIFICATION COMPLETE ==="
```

---

## Summary of Changes by File

| File | Task(s) |
|---|---|
| `backend/requirements.txt` | 5, 9, 11, 14 |
| `backend/app/core/config.py` | 1 |
| `backend/app/core/telemetry.py` | 14 (new file) |
| `backend/app/main.py` | 2, 8, 9, 14 |
| `backend/app/api/routes.py` | 4, 7, 9, 10, 11, 13 |
| `backend/app/services/agent_runtime.py` | 3, 4, 6, 14 |
| `backend/app/services/embeddings.py` | 5 |
| `backend/app/services/llm_providers.py` | 4 |
| `backend/app/services/kafka_consumer.py` | 8 |
| `backend/app/services/rag.py` | 4, 6 |
| `backend/app/services/stream_manager.py` | 7 (new file) |
| `backend/app/services/repository.py` | 10 |
| `frontend/src/App.tsx` | 12 |
| `frontend/src/api/client.ts` | 12 (new file) |
| `frontend/src/types/index.ts` | 12 (new file) |
| `frontend/src/hooks/*.ts` | 12 (new files) |
| `frontend/src/views/*.tsx` | 12, 13 (new files) |
| `frontend/src/components/*.tsx` | 12 (new files) |
