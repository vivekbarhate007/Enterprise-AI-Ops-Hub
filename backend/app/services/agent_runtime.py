import time
from uuid import uuid4

from sqlalchemy.orm import Session

from ..core.telemetry import tracer
from ..models.schemas import AgentRun, RagSource, StreamEvent
from .llm_providers import LLMRouter
from .rag import RagService


class AgentRuntime:
    """LangGraph-ready orchestration boundary for event-driven agent runs."""

    def __init__(self, router: LLMRouter | None = None, rag: RagService | None = None) -> None:
        self.router = router or LLMRouter()
        self.rag = rag or RagService()

    async def run(self, event: StreamEvent, db: Session) -> AgentRun:
        start = time.monotonic()

        with tracer.start_as_current_span("agent.run") as span:
            span.set_attribute("event.id", event.id)
            span.set_attribute("event.severity", event.severity)
            span.set_attribute("tenant.id", event.tenant_id)

            with tracer.start_as_current_span("rag.retrieve"):
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

            context = "\n".join(f"- {source.title}: {source.text}" for source in retrieved)
            approval_required = event.severity.lower() in {"critical", "high"}
            provider = "anthropic" if "incident" in event.assigned_agent_id else "openai"

            with tracer.start_as_current_span("llm.complete"):
                completion = await self.router.complete(
                    (
                        "You are an enterprise AI operations assistant.\n"
                        f"Event severity: {event.severity}\n"
                        f"Event summary: {event.summary}\n\n"
                        f"Relevant knowledge:\n{context}\n\n"
                        "Recommend a safe, specific enterprise operations action. Cite the knowledge sources."
                    ),
                    provider=provider,
                )

            span.set_attribute("agent.confidence", event.confidence)
            span.set_attribute("agent.approval_required", approval_required)
            latency_ms = int((time.monotonic() - start) * 1000)

            return AgentRun(
                id=f"run_{uuid4().hex[:12]}",
                tenant_id=event.tenant_id,
                agent_id=event.assigned_agent_id,
                event_id=event.id,
                latency_ms=max(latency_ms, 1),
                token_cost_cents=completion.token_cost_cents,
                confidence=event.confidence,
                sources=sources,
                approval_required=approval_required,
                recommended_action=completion.content,
            )
