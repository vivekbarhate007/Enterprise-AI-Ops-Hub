"""initial schema

Revision ID: 20260525_0001
Revises:
Create Date: 2026-05-25
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260525_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("email", sa.String(length=240), nullable=False, unique=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("global_role", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_table(
        "tenant_memberships",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("user_id", sa.String(length=100), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "tenant_id", name="uq_user_tenant_membership"),
    )
    op.create_index("ix_tenant_memberships_user_id", "tenant_memberships", ["user_id"])
    op.create_index("ix_tenant_memberships_tenant_id", "tenant_memberships", ["tenant_id"])
    op.create_table(
        "agents",
        sa.Column("id", sa.String(length=80), primary_key=True),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("domain", sa.String(length=160), nullable=False),
        sa.Column("model_provider", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("budget_cents", sa.Integer(), nullable=False),
        sa.Column("tools_json", sa.Text(), nullable=False),
        sa.Column("guardrails_json", sa.Text(), nullable=False),
    )
    op.create_index("ix_agents_tenant_id", "agents", ["tenant_id"])
    op.create_table(
        "stream_events",
        sa.Column("id", sa.String(length=80), primary_key=True),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("topic", sa.String(length=160), nullable=False),
        sa.Column("severity", sa.String(length=40), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("assigned_agent_id", sa.String(length=80), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_stream_events_tenant_id", "stream_events", ["tenant_id"])
    op.create_index("ix_stream_events_topic", "stream_events", ["topic"])
    op.create_table(
        "approvals",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("action", sa.String(length=240), nullable=False),
        sa.Column("risk", sa.String(length=40), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_approvals_tenant_id", "approvals", ["tenant_id"])
    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("source_type", sa.String(length=80), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_documents_tenant_id", "documents", ["tenant_id"])
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("document_id", sa.String(length=100), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("embedding_json", sa.Text(), nullable=False),
        sa.UniqueConstraint("document_id", "chunk_index", name="uq_document_chunk"),
    )
    op.create_index("ix_document_chunks_tenant_id", "document_chunks", ["tenant_id"])
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("agent_id", sa.String(length=80), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("event_id", sa.String(length=80), sa.ForeignKey("stream_events.id"), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("token_cost_cents", sa.Integer(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("approval_required", sa.Integer(), nullable=False),
        sa.Column("recommended_action", sa.Text(), nullable=False),
        sa.Column("sources_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_agent_runs_tenant_id", "agent_runs", ["tenant_id"])
    op.create_table(
        "agent_traces",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("run_id", sa.String(length=100), sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("event_id", sa.String(length=80), sa.ForeignKey("stream_events.id"), nullable=False),
        sa.Column("agent_id", sa.String(length=80), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("risk", sa.String(length=40), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("approval_required", sa.Integer(), nullable=False),
        sa.Column("steps_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_agent_traces_tenant_id", "agent_traces", ["tenant_id"])
    op.create_index("ix_agent_traces_run_id", "agent_traces", ["run_id"])
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("tenant_id", sa.String(length=120), nullable=False),
        sa.Column("actor", sa.String(length=120), nullable=False),
        sa.Column("action", sa.String(length=160), nullable=False),
        sa.Column("target", sa.String(length=240), nullable=False),
        sa.Column("status", sa.String(length=60), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_audit_logs_tenant_id", "audit_logs", ["tenant_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])


def downgrade() -> None:
    for table in [
        "audit_logs",
        "agent_traces",
        "agent_runs",
        "document_chunks",
        "documents",
        "approvals",
        "stream_events",
        "agents",
        "tenant_memberships",
        "users",
    ]:
        op.drop_table(table)
