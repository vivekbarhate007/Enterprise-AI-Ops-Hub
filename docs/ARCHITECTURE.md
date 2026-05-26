# Architecture

## Request Path

1. React dashboard reads agents, events, approvals, and telemetry from FastAPI.
2. Kafka carries tenant-scoped business events such as latency spikes, failed payments, and VIP support escalations.
3. FastAPI validates tenant scope and sends relevant events into the agent runtime.
4. The LangGraph-ready runtime calls tools through stable contracts.
5. RAG retrieves source chunks from persisted document embeddings and routes the grounded prompt through the LLM provider router.
6. Risky actions create approval requests instead of executing immediately.
7. Every run records latency, tokens, cost, confidence, source citations, and policy outcomes.

## Core Boundaries

- `frontend/src`: dashboard, agent builder views, observability surfaces.
- `backend/app/api`: HTTP and WebSocket endpoints.
- `backend/app/services/agent_runtime.py`: agent orchestration boundary.
- `backend/app/services/repository.py`: SQLAlchemy repository layer for agents, events, approvals, documents, chunks, and runs.
- `backend/app/services/rag.py`: document ingestion, retrieval, and grounded answer generation.
- `backend/app/services/llm_providers.py`: local, OpenAI, and Anthropic provider adapters.
- `backend/app/services/kafka_consumer.py`: Kafka consumer boundary for production event ingestion.
- `infra`: Docker, Kubernetes, and Terraform deployment assets.

## Implemented Upgrades

- SQLite-backed persistence for local development.
- SQLAlchemy models that can move to PostgreSQL.
- Document upload, chunking, local embeddings, and source-attributed retrieval.
- Provider adapters for local fallback, OpenAI, and Anthropic.
- Event ingestion API plus Kafka consumer scaffold.
- Playwright E2E tests for desktop and mobile UI flows.

## Next Production Hardening

- Replace local hash embeddings with provider embeddings or a self-hosted embedding model.
- Add Alembic migrations and PostgreSQL row-level security.
- Enable exactly-once or idempotent Kafka processing semantics where business critical.
- Add OpenTelemetry traces across API, retrieval, provider calls, and tools.
- Add background workers for large document ingestion.
