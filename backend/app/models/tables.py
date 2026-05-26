from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class AgentRecord(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    name: Mapped[str] = mapped_column(String(160))
    domain: Mapped[str] = mapped_column(String(160))
    model_provider: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(40))
    budget_cents: Mapped[int] = mapped_column(Integer)
    tools_json: Mapped[str] = mapped_column(Text)
    guardrails_json: Mapped[str] = mapped_column(Text)


class EventRecord(Base):
    __tablename__ = "stream_events"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    topic: Mapped[str] = mapped_column(String(160), index=True)
    severity: Mapped[str] = mapped_column(String(40))
    summary: Mapped[str] = mapped_column(Text)
    assigned_agent_id: Mapped[str] = mapped_column(String(80), ForeignKey("agents.id"))
    confidence: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ApprovalRecord(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    action: Mapped[str] = mapped_column(String(240))
    risk: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class DocumentRecord(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    title: Mapped[str] = mapped_column(String(240))
    source_type: Mapped[str] = mapped_column(String(80))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    chunks: Mapped[list["DocumentChunkRecord"]] = relationship(
        cascade="all, delete-orphan",
        back_populates="document",
    )


class DocumentChunkRecord(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (UniqueConstraint("document_id", "chunk_index", name="uq_document_chunk"),)

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    document_id: Mapped[str] = mapped_column(String(100), ForeignKey("documents.id"))
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding_json: Mapped[str] = mapped_column(Text)

    document: Mapped[DocumentRecord] = relationship(back_populates="chunks")


class AgentRunRecord(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    agent_id: Mapped[str] = mapped_column(String(80), ForeignKey("agents.id"))
    event_id: Mapped[str] = mapped_column(String(80), ForeignKey("stream_events.id"))
    latency_ms: Mapped[int] = mapped_column(Integer)
    token_cost_cents: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[float] = mapped_column(Float)
    approval_required: Mapped[int] = mapped_column(Integer)
    recommended_action: Mapped[str] = mapped_column(Text)
    sources_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AgentTraceRecord(Base):
    __tablename__ = "agent_traces"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    run_id: Mapped[str] = mapped_column(String(100), ForeignKey("agent_runs.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(80), ForeignKey("stream_events.id"))
    agent_id: Mapped[str] = mapped_column(String(80), ForeignKey("agents.id"))
    risk: Mapped[str] = mapped_column(String(40))
    confidence: Mapped[float] = mapped_column(Float)
    approval_required: Mapped[int] = mapped_column(Integer)
    steps_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AuditLogRecord(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    actor: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(160), index=True)
    target: Mapped[str] = mapped_column(String(240))
    status: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class UserRecord(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    email: Mapped[str] = mapped_column(String(240), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(Text)
    global_role: Mapped[str] = mapped_column(String(40), default="Viewer")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class PasswordResetTokenRecord(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(100), ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class TenantMembershipRecord(Base):
    __tablename__ = "tenant_memberships"
    __table_args__ = (UniqueConstraint("user_id", "tenant_id", name="uq_user_tenant_membership"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(100), ForeignKey("users.id"), index=True)
    tenant_id: Mapped[str] = mapped_column(String(120), index=True)
    role: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
