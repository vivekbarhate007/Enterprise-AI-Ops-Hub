# Production Readiness Plan

This project is now positioned as a production-style MVP. To sell it confidently, describe it as a pilot-ready platform that can be hardened for a buyer's environment.

## Current Production-Style Capabilities

- Tenant-scoped API routes for agents, events, approvals, documents, RAG, runs, traces, audit logs, and admin summary.
- Persistent SQLAlchemy data model that runs locally on SQLite and is PostgreSQL-ready.
- RAG document lifecycle: upload, chunk, embed, retrieve, re-index, delete, and cite sources.
- Provider router with local fallback plus Groq, OpenAI, and Anthropic adapter boundaries.
- Slack, GitHub, and PagerDuty integration layer with dry-run safety and live-key readiness.
- Admin Console with tenant switch, integration tests, audit log viewer, and CSV export.
- Persisted demo users, tenant memberships, backend-issued JWT sessions, and API-level RBAC.
- Backend `/health` and `/ready` endpoints for uptime and dependency readiness.
- Pytest backend coverage and Playwright desktop/mobile E2E coverage.

## Required Before Handling Real Customer Data

1. Authentication and authorization
   - Replace demo email/password accounts with OAuth/passwordless login.
   - Add user invitation and tenant membership management UI.
   - Add refresh tokens/session rotation and password reset if password auth remains enabled.
   - Continue enforcing authorization in backend dependencies, not only the UI.

2. Database hardening
   - Move production to PostgreSQL.
   - Add Alembic migrations.
   - Add indexes for tenant-heavy query paths.
   - Add backup and restore documentation.

3. Security controls
   - Add file upload size limits and malware scanning boundary.
   - Add request rate limits.
   - Add immutable audit log storage for sensitive actions.
   - Rotate and scope integration secrets.

4. Background processing
   - Move document ingestion, embeddings, integration delivery, and agent runs to workers.
   - Add retries, idempotency keys, and dead-letter handling.

5. Observability
   - Add structured JSON logs.
   - Add OpenTelemetry traces for API, retrieval, provider calls, and integrations.
   - Add metrics for latency, errors, token cost, and document ingestion.

6. Deployment
   - Build production Docker images.
   - Use environment-specific config.
   - Wire `/ready` into load balancer and Kubernetes readiness checks.
   - Run CI on every PR: backend tests, frontend build, E2E smoke, and dependency scan.

## Selling Position

Use this positioning:

> Enterprise AI Ops Hub is a pilot-ready AI operations command center for teams that want tenant-scoped agents, internal knowledge retrieval, human approvals, audit logs, and Slack/GitHub/PagerDuty workflows.

Avoid claiming it is a finished production SaaS. Claim that it is ready for paid customization and pilot deployment.

## Next High-Impact Build Order

1. Real login, tenant membership, and backend RBAC.
2. Alembic migrations plus PostgreSQL-first local Docker setup.
3. Background worker queue for document ingestion and integration delivery.
4. Structured logs and OpenTelemetry traces.
5. Production Docker image and CI security scan.
