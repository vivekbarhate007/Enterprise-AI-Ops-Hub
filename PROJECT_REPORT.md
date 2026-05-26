# Enterprise AI Ops Hub - Project Report

## 1. Executive Summary

Enterprise AI Ops Hub is a full-stack enterprise AI operations platform. It is designed as a production-style SaaS system where teams configure AI agents that monitor real-time business events, retrieve internal knowledge, recommend actions, and require human approval before executing high-risk workflows.

The project demonstrates skills across:

- React + TypeScript frontend engineering
- FastAPI backend development
- Agentic AI architecture
- RAG and embeddings
- LLM provider abstraction
- SQL persistence
- Kafka-ready event ingestion
- WebSocket streaming
- Docker, Kubernetes, Terraform, and CI/CD foundations
- Backend and E2E testing

This is intentionally not a simple chatbot. It models how AI systems are deployed in real companies: tenant-aware data, approval gates, retrieval grounding, cost tracking, observability, and extensible infrastructure.

## 2. What Has Been Built

### Frontend

The frontend is a polished React + TypeScript dashboard built with Vite.

Implemented UI areas:

- Command Center dashboard
- Agent Builder view
- Knowledge Base view
- Approval Center view
- Streaming/Event view
- Settings/System Design view
- Search filtering for agents and events
- Deploy-agent modal flow
- Agent trace drawer
- Approval state changes
- Notification/status messaging
- Responsive layout for desktop and mobile

Important files:

- `frontend/src/App.tsx`
- `frontend/src/data.ts`
- `frontend/src/styles.css`
- `frontend/playwright.config.ts`
- `frontend/tests/e2e/app.spec.ts`

### Backend

The backend is built with FastAPI and now uses real persistence through SQLAlchemy.

Implemented backend capabilities:

- Health endpoint
- Agent listing
- Event listing
- Event ingestion
- Approval listing
- Agent run execution
- Agent run persistence
- Document listing
- Document upload
- Text chunking
- Local deterministic embeddings
- RAG retrieval
- Grounded answer generation
- LLM completion endpoint
- WebSocket event stream

Important files:

- `backend/app/main.py`
- `backend/app/api/routes.py`
- `backend/app/core/config.py`
- `backend/app/core/database.py`
- `backend/app/models/schemas.py`
- `backend/app/models/tables.py`
- `backend/app/services/repository.py`
- `backend/app/services/rag.py`
- `backend/app/services/embeddings.py`
- `backend/app/services/llm_providers.py`
- `backend/app/services/agent_runtime.py`
- `backend/app/services/kafka_consumer.py`

### Database Persistence

SQLite is used locally for easy development. The code is structured so it can move to PostgreSQL later.

Persisted entities:

- Agents
- Stream events
- Approval requests
- Documents
- Document chunks
- Agent runs

The local database file is generated as:

```text
ai_ops_hub.db
```

This file is intentionally excluded from the zip/git-style package because it is generated locally.

### RAG Pipeline

The RAG system currently supports:

1. Uploading a text-readable document
2. Splitting the document into chunks
3. Creating deterministic local embeddings
4. Persisting document chunks
5. Retrieving relevant chunks for a query
6. Returning source-attributed answers

Useful endpoints:

```text
POST /api/v1/documents/upload
GET  /api/v1/documents
GET  /api/v1/rag/query?query=checkout latency
```

### LLM Provider Adapters

Implemented provider architecture:

- Local fallback provider
- OpenAI provider adapter
- Anthropic provider adapter

Current behavior:

- If no API key is configured, the system safely falls back to local deterministic responses.
- If `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set, the adapter paths can call the real provider APIs.

Useful endpoint:

```text
POST /api/v1/llm/complete
```

Example payload:

```json
{
  "prompt": "Explain checkout latency",
  "provider": "openai"
}
```

### Kafka/Event Streaming

Implemented:

- Event ingestion endpoint for local development
- WebSocket stream endpoint
- Kafka consumer scaffold using `aiokafka`

Useful endpoints:

```text
GET  /api/v1/events
POST /api/v1/events
GET  /api/v1/stream
```

Kafka consumer file:

```text
backend/app/services/kafka_consumer.py
```

The Kafka consumer is scaffolded but not automatically started by the API process yet. This is intentional because production systems usually run consumers as separate workers.

### Infrastructure

Included:

- Docker Compose
- Backend Dockerfile
- Frontend Dockerfile
- Kubernetes deployment/service manifests
- Terraform AWS EKS/RDS skeleton
- GitHub Actions CI workflow
- Environment example file

Important files:

- `docker-compose.yml`
- `infra/docker/api.Dockerfile`
- `infra/docker/frontend.Dockerfile`
- `infra/k8s/api-deployment.yaml`
- `infra/k8s/frontend-deployment.yaml`
- `infra/terraform/main.tf`
- `infra/terraform/variables.tf`
- `.github/workflows/ci.yml`
- `.env.example`

### Testing

Implemented tests:

- Backend API tests with Pytest
- UI E2E tests with Playwright
- Desktop Chromium test project
- Mobile viewport test project
- Frontend TypeScript build verification

Test files:

- `backend/tests/test_api.py`
- `frontend/tests/e2e/app.spec.ts`

Verified commands:

```bash
npm --prefix frontend run build
.venv/bin/python -m pytest backend/tests
npm --prefix frontend run e2e
```

Latest verification results:

- Frontend build: passed
- Backend tests: 8 passed
- Playwright E2E: 4 passed

## 3. Current API Surface

### Health

```text
GET /health
```

### Agents

```text
GET /api/v1/agents
```

### Events

```text
GET  /api/v1/events
POST /api/v1/events
POST /api/v1/events/{event_id}/run
```

### Runs

```text
GET /api/v1/runs
```

### Approvals

```text
GET /api/v1/approvals
```

### Documents and RAG

```text
GET  /api/v1/documents
POST /api/v1/documents/upload
GET  /api/v1/rag/query?query=...
```

### LLM

```text
POST /api/v1/llm/complete
```

### WebSocket

```text
WS /api/v1/stream
```

## 4. How To Run Locally

### Frontend

```bash
cd enterprise-ai-ops-hub
npm --prefix frontend install
npm --prefix frontend run dev
```

Frontend URL:

```text
http://127.0.0.1:5173/
```

### Backend

```bash
cd enterprise-ai-ops-hub
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Backend URL:

```text
http://127.0.0.1:8000/
```

API docs:

```text
http://127.0.0.1:8000/docs
```

## 5. How To Test

### Backend Tests

```bash
.venv/bin/python -m pytest backend/tests
```

### Frontend Build

```bash
npm --prefix frontend run build
```

### Playwright E2E

Install browser runtime once:

```bash
npm --prefix frontend exec playwright install chromium
```

Run E2E:

```bash
npm --prefix frontend run e2e
```

## 6. What Still Needs To Be Done

### 1. Replace Local Embeddings With Production Embeddings

Current state:

- The app uses deterministic local hash-based embeddings.
- This is excellent for local tests because it is fast, free, and stable.

Next step:

- Add real embedding providers:
  - OpenAI embeddings
  - Cohere embeddings
  - Voyage embeddings
  - self-hosted sentence-transformers

How to do it:

1. Create `backend/app/services/embedding_providers.py`.
2. Add an `EmbeddingRouter` similar to `LLMRouter`.
3. Add env vars like:

```text
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=...
```

4. Replace calls to `embed_text()` with the router.
5. Keep local embeddings as fallback for tests.

### 2. Move SQLite To PostgreSQL + pgvector

Current state:

- SQLite is used locally.
- SQLAlchemy models are portable.

Next step:

- Use PostgreSQL in Docker Compose.
- Enable pgvector.
- Store embeddings in vector columns instead of JSON text.

How to do it:

1. Add Alembic migrations.
2. Add pgvector extension migration:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

3. Change `DocumentChunkRecord.embedding_json` into a vector column.
4. Use vector similarity search in SQL.
5. Add tenant-level indexes.

### 3. Add Alembic Migrations

Current state:

- SQLAlchemy creates tables automatically during startup.

Next step:

- Use Alembic for production migrations.

How to do it:

1. Install Alembic.
2. Run:

```bash
alembic init backend/migrations
```

3. Point Alembic to `Base.metadata`.
4. Generate first migration:

```bash
alembic revision --autogenerate -m "initial schema"
```

5. Run migrations during deploy.

### 4. Start Kafka Consumer As A Worker

Current state:

- Kafka consumer class exists.
- API has event ingestion endpoint.
- Consumer is not automatically running.

Next step:

- Add a worker entrypoint.

How to do it:

1. Create:

```text
backend/app/workers/event_consumer.py
```

2. Start `EventConsumer.consume_forever()`.
3. Add a Docker Compose worker service.
4. Add Kubernetes deployment for the worker.
5. Make Kafka event processing idempotent by event ID.

### 5. Connect Frontend To Live Backend APIs

Current state:

- Frontend uses high-quality local data.
- Backend APIs are real.

Next step:

- Replace static frontend data with API calls.

How to do it:

1. Create `frontend/src/api.ts`.
2. Add functions:
   - `fetchAgents`
   - `fetchEvents`
   - `fetchApprovals`
   - `fetchDocuments`
   - `runAgent`
   - `uploadDocument`
3. Use React state/effects or a query library.
4. Add loading, error, and empty states.
5. Connect WebSocket stream to the Live Stream panel.

### 6. Add Authentication And RBAC

Current state:

- Data model is tenant-aware.
- Auth is not enforced yet.

Next step:

- Add JWT auth and role-based permissions.

How to do it:

1. Add users, roles, memberships tables.
2. Add JWT validation dependency.
3. Add route guards:
   - admin
   - operator
   - viewer
4. Scope every query by tenant ID from token claims.
5. Add tests for cross-tenant isolation.

### 7. Add Real Agent Tool Execution

Current state:

- Agent runtime simulates recommendations and approval decisions.

Next step:

- Add real tool contracts.

How to do it:

1. Define tool interface:

```python
class Tool:
    name: str
    risk_level: str
    def run(self, input: dict) -> dict: ...
```

2. Add tools:
   - SQL diagnostics
   - webhook action
   - Slack draft
   - incident creation
3. Route high-risk tools through approval.
4. Store tool calls in an audit table.

### 8. Add Observability

Current state:

- Runs store latency, confidence, cost, sources, and recommendation.

Next step:

- Add OpenTelemetry and structured logs.

How to do it:

1. Add OpenTelemetry FastAPI instrumentation.
2. Trace:
   - API request
   - retrieval
   - provider call
   - tool call
   - approval decision
3. Export to Jaeger, Tempo, or Datadog.
4. Show trace IDs in the UI trace drawer.

### 9. Improve Document Handling

Current state:

- Text-readable uploads work.

Next step:

- Support PDF, DOCX, CSV, and Markdown parsing.

How to do it:

1. Add parsers:
   - `pypdf`
   - `python-docx`
   - CSV parser
2. Add file type validation.
3. Add async background ingestion for large files.
4. Add document deletion and re-indexing.

### 10. Production Deployment

Current state:

- Docker, Kubernetes, and Terraform skeletons exist.

Next step:

- Make deploy fully runnable.

How to do it:

1. Build and push frontend/backend images.
2. Replace placeholder image names in K8s manifests.
3. Add secrets for API keys and database credentials.
4. Add ingress and TLS.
5. Add CI/CD deploy step.
6. Add Terraform outputs for cluster and database endpoints.

## 7. Recommended Roadmap

### Phase 1: Full Local Product

- Connect frontend to backend APIs.
- Add document upload UI.
- Add run-agent button from event cards.
- Add real WebSocket updates in the UI.
- Add approval API mutation.

### Phase 2: Real GenAI

- Add real embedding provider.
- Add OpenAI/Anthropic credentials.
- Add provider usage/cost tracking.
- Add RAG evaluation tests.

### Phase 3: Enterprise Backend

- PostgreSQL + pgvector.
- Alembic migrations.
- Auth/RBAC.
- Tenant isolation tests.
- Audit trail tables.

### Phase 4: Streaming And Agents

- Run Kafka worker.
- Add tool execution registry.
- Add real approval workflow.
- Add retries and dead-letter handling.

### Phase 5: Cloud Deployment

- Complete Terraform.
- Deploy to AWS EKS.
- Add CI/CD image publishing.
- Add observability stack.

## 8. Current Status

The project is in a strong production-MVP state.

Working now:

- Professional UI
- Real FastAPI backend
- SQL persistence
- RAG upload/query path
- LLM provider abstraction
- Kafka consumer boundary
- E2E test suite
- Docker/K8s/Terraform foundation

Not fully production yet:

- Frontend still uses local demo data instead of live API calls.
- Kafka worker is scaffolded but not deployed as a running process.
- Embeddings are local deterministic vectors, not production ML embeddings.
- SQLite should become PostgreSQL + pgvector.
- Auth/RBAC needs to be enforced.
- Terraform is a skeleton, not a complete cloud deployment.

## 9. Interview Positioning

Use this description:

> Built an enterprise AI operations platform using React, TypeScript, FastAPI, SQLAlchemy, RAG, LLM provider adapters, Kafka-ready event ingestion, WebSockets, Docker, Kubernetes, Terraform, Pytest, and Playwright. The system lets teams configure AI agents that monitor operational events, retrieve internal knowledge, recommend actions, and route risky actions through human approval with persisted runs and source attribution.

This framing shows:

- Full-stack engineering
- GenAI/RAG implementation
- Agent architecture
- Distributed systems awareness
- Production backend patterns
- Testing discipline
- Cloud-native deployment awareness
