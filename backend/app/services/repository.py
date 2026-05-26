import json
from csv import DictWriter
from datetime import UTC, datetime
from io import StringIO
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..models.schemas import (
    Agent,
    AgentRun,
    AgentTrace,
    AgentStatus,
    AgentTemplate,
    AgentTemplateDeployResult,
    AdminSummary,
    AuditLog,
    AuthUser,
    ApprovalRequest,
    Document,
    DocumentChunk,
    DocumentUploadResult,
    OnboardingRequest,
    OnboardingResult,
    RagSource,
    RoiSummary,
    SecurityEvent,
    SecuritySummary,
    StreamEvent,
    Tenant,
    TenantMembership,
    TraceStep,
)
from ..models.tables import (
    AgentRecord,
    AgentRunRecord,
    AgentTraceRecord,
    AuditLogRecord,
    ApprovalRecord,
    DocumentChunkRecord,
    DocumentRecord,
    EventRecord,
    PasswordResetTokenRecord,
    TenantMembershipRecord,
    UserRecord,
)
from .embeddings import VECTOR_SIZE, chunk_text, embed_text
from .passwords import hash_password


TENANT_ID = settings.demo_tenant_id

TENANTS = [
    Tenant(
        id="tenant_northstar_health",
        name="Northstar Health",
        industry="Healthtech",
        plan="Enterprise",
        region="us-east-1",
        budget_cents=5000,
        provider_mode="groq-ready",
        user_count=42,
        integration_count=3,
    ),
    Tenant(
        id="tenant_acme_fintech",
        name="Acme Fintech",
        industry="Fintech",
        plan="Scale",
        region="us-west-2",
        budget_cents=8000,
        provider_mode="local-safe",
        user_count=31,
        integration_count=2,
    ),
    Tenant(
        id="tenant_cloudcart_retail",
        name="CloudCart Retail",
        industry="Retail",
        plan="Growth",
        region="eu-west-1",
        budget_cents=6500,
        provider_mode="groq-ready",
        user_count=26,
        integration_count=2,
    ),
]

AGENT_TEMPLATES = [
    AgentTemplate(
        id="tpl_incident_triage",
        name="Incident Triage Agent",
        category="SRE",
        description="Routes latency, error-rate, and availability incidents through RAG, diagnostics, PagerDuty, and approval gates.",
        model_provider="groq:llama-3.3-70b-versatile",
        tools=["Runbook RAG", "SQL Diagnostics", "PagerDuty MCP", "Slack Draft"],
        guardrails=["SRE approval before restart", "Cite runbooks", "Tenant-only retrieval"],
        estimated_cost_cents=2,
        required_role="Admin",
    ),
    AgentTemplate(
        id="tpl_customer_support",
        name="Customer Support Agent",
        category="Support",
        description="Summarizes tickets, retrieves policy, drafts customer replies, and asks support leads before external communication.",
        model_provider="groq:llama-3.3-70b-versatile",
        tools=["Zendesk Queue", "Policy RAG", "Tone Guardrail", "Email Draft"],
        guardrails=["Support lead review", "PII redaction", "No external send without approval"],
        estimated_cost_cents=1,
        required_role="Admin",
    ),
    AgentTemplate(
        id="tpl_revenue_risk",
        name="Revenue Risk Agent",
        category="Finance",
        description="Detects payment failures and churn risk from billing streams, then prepares finance-safe recovery actions.",
        model_provider="openai:gpt-4o-mini",
        tools=["Stripe Events", "CRM Query", "Anomaly Detector", "Approval Gate"],
        guardrails=["No refunds without approval", "Mask customer PII", "Finance audit trail"],
        estimated_cost_cents=2,
        required_role="Admin",
    ),
    AgentTemplate(
        id="tpl_security_alert",
        name="Security Alert Agent",
        category="Security",
        description="Triages suspicious login velocity, API key exposure, and unusual tenant access changes.",
        model_provider="groq:llama-3.3-70b-versatile",
        tools=["Audit Log Search", "Session Review", "Slack Security Channel"],
        guardrails=["Human review for account lock", "Evidence required", "No destructive action"],
        estimated_cost_cents=2,
        required_role="Admin",
    ),
    AgentTemplate(
        id="tpl_compliance_evidence",
        name="Compliance Evidence Agent",
        category="GRC",
        description="Collects approval, trace, and audit evidence into exportable packets for SOC2-style review.",
        model_provider="local-enterprise-simulator",
        tools=["Audit Export", "Trace Replay", "Evidence Builder"],
        guardrails=["Read-only by default", "Source attribution", "Reviewer signoff"],
        estimated_cost_cents=1,
        required_role="Admin",
    ),
]


def list_tenants() -> list[Tenant]:
    return TENANTS


def list_agent_templates(db: Session, tenant_id: str) -> list[AgentTemplate]:
    existing_names = {agent.name for agent in list_agents(db, tenant_id)}
    return [
        template.model_copy(update={"deploy_status": "deployed" if template.name in existing_names else "available"})
        for template in AGENT_TEMPLATES
    ]


def deploy_agent_template(
    db: Session,
    *,
    tenant_id: str,
    template_id: str,
    actor: str,
) -> AgentTemplateDeployResult | None:
    template = next((item for item in AGENT_TEMPLATES if item.id == template_id), None)

    if not template:
        return None

    agent_id = f"agent_{template_id.removeprefix('tpl_')}_{uuid4().hex[:6]}"
    db.add(
        AgentRecord(
            id=agent_id,
            tenant_id=tenant_id,
            name=template.name,
            domain=template.category,
            model_provider=template.model_provider,
            status=AgentStatus.deployed.value,
            budget_cents=max(template.estimated_cost_cents * 2500, 2500),
            tools_json=json.dumps(template.tools),
            guardrails_json=json.dumps(template.guardrails),
        )
    )
    db.commit()
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=actor,
        action="agent.template.deployed",
        target=agent_id,
        status="deployed",
        detail=f"{template.name} deployed from marketplace template {template.id}.",
    )
    return AgentTemplateDeployResult(
        template_id=template.id,
        agent_id=agent_id,
        tenant_id=tenant_id,
        status="deployed",
        message=f"{template.name} deployed with {len(template.tools)} tools and {len(template.guardrails)} guardrails.",
    )


def get_tenant(tenant_id: str) -> Tenant | None:
    return next((tenant for tenant in TENANTS if tenant.id == tenant_id), None)


def user_from_record(record: UserRecord, memberships: list[TenantMembershipRecord]) -> AuthUser:
    return AuthUser(
        id=record.id,
        email=record.email,
        name=record.name,
        role=record.global_role,
        memberships=[
            TenantMembership(tenant_id=membership.tenant_id, role=membership.role)
            for membership in memberships
        ],
    )


def get_user_by_email(db: Session, email: str) -> UserRecord | None:
    return db.scalars(select(UserRecord).where(UserRecord.email == email.strip().lower())).first()


def save_password_reset_token(
    db: Session,
    *,
    user_id: str,
    token_hash: str,
    expires_at: datetime,
) -> PasswordResetTokenRecord:
    record = PasswordResetTokenRecord(
        id=f"reset_{uuid4().hex[:12]}",
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_active_password_reset_token(db: Session, token_hash: str) -> PasswordResetTokenRecord | None:
    now = datetime.now(UTC)
    return db.scalars(
        select(PasswordResetTokenRecord).where(
            PasswordResetTokenRecord.token_hash == token_hash,
            PasswordResetTokenRecord.used_at.is_(None),
            PasswordResetTokenRecord.expires_at > now,
        )
    ).first()


def consume_password_reset_token(db: Session, record: PasswordResetTokenRecord) -> None:
    record.used_at = datetime.now(UTC)
    db.commit()


def update_user_password(db: Session, user_id: str, new_password: str) -> bool:
    record = db.get(UserRecord, user_id)
    if not record:
        return False
    record.password_hash = hash_password(new_password)
    db.commit()
    return True


def get_user_by_id(db: Session, user_id: str) -> UserRecord | None:
    return db.get(UserRecord, user_id)


def list_user_memberships(db: Session, user_id: str) -> list[TenantMembershipRecord]:
    return db.scalars(select(TenantMembershipRecord).where(TenantMembershipRecord.user_id == user_id)).all()


def get_auth_user(db: Session, user_id: str) -> AuthUser | None:
    record = get_user_by_id(db, user_id)
    if not record:
        return None
    return user_from_record(record, list_user_memberships(db, user_id))


def _loads(value: str) -> list[str]:
    loaded = json.loads(value)
    return loaded if isinstance(loaded, list) else []


def agent_from_record(record: AgentRecord) -> Agent:
    return Agent(
        id=record.id,
        tenant_id=record.tenant_id,
        name=record.name,
        domain=record.domain,
        model_provider=record.model_provider,
        status=AgentStatus(record.status),
        budget_cents=record.budget_cents,
        tools=_loads(record.tools_json),
        guardrails=_loads(record.guardrails_json),
    )


def event_from_record(record: EventRecord) -> StreamEvent:
    return StreamEvent(
        id=record.id,
        tenant_id=record.tenant_id,
        topic=record.topic,
        severity=record.severity,
        summary=record.summary,
        assigned_agent_id=record.assigned_agent_id,
        confidence=record.confidence,
    )


def audit_from_record(record: AuditLogRecord) -> AuditLog:
    return AuditLog(
        id=record.id,
        tenant_id=record.tenant_id,
        actor=record.actor,
        action=record.action,
        target=record.target,
        status=record.status,
        detail=record.detail,
        created_at=record.created_at.isoformat(),
    )


def approval_from_record(record: ApprovalRecord) -> ApprovalRequest:
    return ApprovalRequest(
        id=record.id,
        tenant_id=record.tenant_id,
        action=record.action,
        risk=record.risk,
        reason=record.reason,
        status=record.status,
    )


def run_to_record(run: AgentRun) -> AgentRunRecord:
    return AgentRunRecord(
        id=run.id,
        tenant_id=run.tenant_id,
        agent_id=run.agent_id,
        event_id=run.event_id,
        latency_ms=run.latency_ms,
        token_cost_cents=run.token_cost_cents,
        confidence=run.confidence,
        approval_required=1 if run.approval_required else 0,
        recommended_action=run.recommended_action,
        sources_json=json.dumps([source.model_dump() for source in run.sources]),
    )


def run_from_record(record: AgentRunRecord) -> AgentRun:
    return AgentRun(
        id=record.id,
        tenant_id=record.tenant_id,
        agent_id=record.agent_id,
        event_id=record.event_id,
        latency_ms=record.latency_ms,
        token_cost_cents=record.token_cost_cents,
        confidence=record.confidence,
        sources=[RagSource(**source) for source in json.loads(record.sources_json)],
        approval_required=bool(record.approval_required),
        recommended_action=record.recommended_action,
    )


def trace_to_record(trace: AgentTrace) -> AgentTraceRecord:
    return AgentTraceRecord(
        id=trace.id,
        tenant_id=trace.tenant_id,
        run_id=trace.run_id,
        event_id=trace.event_id,
        agent_id=trace.agent_id,
        risk=trace.risk,
        confidence=trace.confidence,
        approval_required=1 if trace.approval_required else 0,
        steps_json=json.dumps([step.model_dump() for step in trace.steps]),
    )


def trace_from_record(record: AgentTraceRecord) -> AgentTrace:
    return AgentTrace(
        id=record.id,
        tenant_id=record.tenant_id,
        run_id=record.run_id,
        event_id=record.event_id,
        agent_id=record.agent_id,
        risk=record.risk,
        confidence=record.confidence,
        approval_required=bool(record.approval_required),
        steps=[TraceStep(**step) for step in json.loads(record.steps_json)],
    )


def list_agents(db: Session, tenant_id: str = TENANT_ID, *, limit: int = 50, offset: int = 0) -> list[Agent]:
    records = db.scalars(
        select(AgentRecord)
        .where(AgentRecord.tenant_id == tenant_id)
        .order_by(AgentRecord.name.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [agent_from_record(record) for record in records]


def list_stream_events(db: Session, tenant_id: str = TENANT_ID, *, limit: int = 50, offset: int = 0) -> list[StreamEvent]:
    records = db.scalars(
        select(EventRecord)
        .where(EventRecord.tenant_id == tenant_id)
        .order_by(EventRecord.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [event_from_record(record) for record in records]


def get_stream_event(db: Session, event_id: str, tenant_id: str = TENANT_ID) -> StreamEvent | None:
    record = db.get(EventRecord, event_id)
    if not record or record.tenant_id != tenant_id:
        return None
    return event_from_record(record)


def upsert_stream_event(db: Session, event: StreamEvent) -> StreamEvent:
    existing = db.get(EventRecord, event.id)
    if existing:
        existing.topic = event.topic
        existing.severity = event.severity
        existing.summary = event.summary
        existing.assigned_agent_id = event.assigned_agent_id
        existing.confidence = event.confidence
    else:
        db.add(
            EventRecord(
                id=event.id,
                tenant_id=event.tenant_id,
                topic=event.topic,
                severity=event.severity,
                summary=event.summary,
                assigned_agent_id=event.assigned_agent_id,
                confidence=event.confidence,
            )
        )
    db.commit()
    return event


def list_approvals(db: Session, tenant_id: str = TENANT_ID, *, limit: int = 50, offset: int = 0) -> list[ApprovalRequest]:
    records = db.scalars(
        select(ApprovalRecord)
        .where(ApprovalRecord.tenant_id == tenant_id)
        .order_by(ApprovalRecord.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [approval_from_record(record) for record in records]


def update_approval_status(
    db: Session,
    approval_id: str,
    status: str,
    tenant_id: str = TENANT_ID,
) -> ApprovalRequest | None:
    record = db.get(ApprovalRecord, approval_id)

    if not record or record.tenant_id != tenant_id:
        return None

    record.status = status
    db.commit()
    db.refresh(record)
    return approval_from_record(record)


def save_agent_run(db: Session, run: AgentRun) -> AgentRun:
    existing = db.get(AgentRunRecord, run.id)
    if existing:
        db.delete(existing)
        db.flush()
    db.add(run_to_record(run))
    db.commit()
    return run


def list_agent_runs(db: Session, tenant_id: str = TENANT_ID, *, limit: int = 50, offset: int = 0) -> list[AgentRun]:
    records = db.scalars(
        select(AgentRunRecord)
        .where(AgentRunRecord.tenant_id == tenant_id)
        .order_by(AgentRunRecord.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [run_from_record(record) for record in records]


def build_agent_trace(event: StreamEvent, run: AgentRun) -> AgentTrace:
    risk = "high" if run.approval_required else "standard"
    top_source = run.sources[0] if run.sources else None
    source_evidence = (
        f"{top_source.title} ({round(top_source.relevance * 100)}% relevance)"
        if top_source
        else "No source was retrieved"
    )

    steps = [
        TraceStep(
            title="Event received",
            detail=f"{event.topic} event was routed to {event.assigned_agent_id}.",
            evidence=f"{event.severity} severity with {round(event.confidence * 100)}% event confidence.",
        ),
        TraceStep(
            title="Agent selected",
            detail=f"{run.agent_id} was selected from the event routing policy.",
            evidence=f"Run id {run.id} is linked to event {run.event_id}.",
        ),
        TraceStep(
            title="Knowledge retrieved",
            detail=f"{len(run.sources)} trusted sources were attached to the recommendation.",
            evidence=source_evidence,
        ),
        TraceStep(
            title="Risk evaluated",
            detail=f"Risk was classified as {risk} from severity and confidence signals.",
            evidence=f"Approval required: {'yes' if run.approval_required else 'no'}.",
        ),
        TraceStep(
            title="Action recommended",
            detail=run.recommended_action,
            evidence=f"{run.latency_ms}ms latency and ${run.token_cost_cents / 100:.3f} estimated LLM cost.",
        ),
        TraceStep(
            title="Audit saved",
            detail="Run, sources, risk decision, and approval signal were persisted for review.",
            evidence=f"Trace id trace_{run.id}.",
        ),
    ]

    return AgentTrace(
        id=f"trace_{run.id}",
        tenant_id=run.tenant_id,
        run_id=run.id,
        event_id=run.event_id,
        agent_id=run.agent_id,
        risk=risk,
        confidence=run.confidence,
        approval_required=run.approval_required,
        steps=steps,
    )


def save_agent_trace(db: Session, trace: AgentTrace) -> AgentTrace:
    existing = db.get(AgentTraceRecord, trace.id)
    if existing:
        db.delete(existing)
        db.flush()
    db.add(trace_to_record(trace))
    db.commit()
    return trace


def get_agent_trace(db: Session, run_id: str, tenant_id: str = TENANT_ID) -> AgentTrace | None:
    record = db.scalars(
        select(AgentTraceRecord).where(
            AgentTraceRecord.run_id == run_id,
            AgentTraceRecord.tenant_id == tenant_id,
        )
    ).first()
    return trace_from_record(record) if record else None


def save_document(
    db: Session,
    *,
    tenant_id: str,
    title: str,
    source_type: str,
    content: str,
    chunks: list[tuple[str, list[float]]],
) -> DocumentUploadResult:
    normalized_title = title.strip().casefold()
    existing = db.scalars(
        select(DocumentRecord).where(DocumentRecord.tenant_id == tenant_id)
    ).all()

    for record in existing:
        if record.title.strip().casefold() == normalized_title:
            db.delete(record)

    if existing:
        db.flush()

    document_id = f"doc_{uuid4().hex[:12]}"
    document = DocumentRecord(
        id=document_id,
        tenant_id=tenant_id,
        title=title,
        source_type=source_type,
        content=content,
    )
    db.add(document)
    for index, (chunk_text, embedding) in enumerate(chunks):
        db.add(
            DocumentChunkRecord(
                id=f"{document_id}_chunk_{index}",
                tenant_id=tenant_id,
                document_id=document_id,
                chunk_index=index,
                text=chunk_text,
                embedding_json=json.dumps(embedding),
            )
        )
    db.commit()
    return DocumentUploadResult(
        id=document_id,
        tenant_id=tenant_id,
        title=title,
        source_type=source_type,
        chunk_count=len(chunks),
    )


def list_documents(db: Session, tenant_id: str = TENANT_ID, *, limit: int = 50, offset: int = 0) -> list[Document]:
    records = db.scalars(
        select(DocumentRecord)
        .where(DocumentRecord.tenant_id == tenant_id)
        .order_by(DocumentRecord.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [
        Document(
            id=record.id,
            tenant_id=record.tenant_id,
            title=record.title,
            source_type=record.source_type,
            chunk_count=len(record.chunks),
        )
        for record in records
    ]


def delete_document(db: Session, document_id: str, tenant_id: str = TENANT_ID) -> bool:
    record = db.get(DocumentRecord, document_id)

    if not record or record.tenant_id != tenant_id:
        return False

    db.delete(record)
    db.commit()
    return True


def reindex_document(db: Session, document_id: str, tenant_id: str = TENANT_ID) -> DocumentUploadResult | None:
    record = db.get(DocumentRecord, document_id)

    if not record or record.tenant_id != tenant_id:
        return None

    for chunk in list(record.chunks):
        db.delete(chunk)

    chunks = [(chunk, embed_text(chunk)) for chunk in chunk_text(record.content)]

    for index, (chunk_body, embedding) in enumerate(chunks):
        db.add(
            DocumentChunkRecord(
                id=f"{record.id}_chunk_{index}",
                tenant_id=tenant_id,
                document_id=record.id,
                chunk_index=index,
                text=chunk_body,
                embedding_json=json.dumps(embedding),
            )
        )

    db.commit()

    return DocumentUploadResult(
        id=record.id,
        tenant_id=record.tenant_id,
        title=record.title,
        source_type=record.source_type,
        chunk_count=len(chunks),
    )


def list_chunks(db: Session, tenant_id: str = TENANT_ID) -> list[DocumentChunk]:
    records = db.scalars(select(DocumentChunkRecord).where(DocumentChunkRecord.tenant_id == tenant_id)).all()
    return [
        DocumentChunk(
            id=record.id,
            tenant_id=record.tenant_id,
            document_id=record.document_id,
            text=record.text,
            embedding=json.loads(record.embedding_json),
        )
        for record in records
    ]


def refresh_document_embedding_dimensions(db: Session) -> int:
    refreshed = 0
    records = db.scalars(select(DocumentChunkRecord)).all()
    for record in records:
        try:
            embedding = json.loads(record.embedding_json)
        except json.JSONDecodeError:
            embedding = []

        if len(embedding) != VECTOR_SIZE:
            record.embedding_json = json.dumps(embed_text(record.text))
            refreshed += 1

    if refreshed:
        db.commit()
    return refreshed


def record_audit(
    db: Session,
    *,
    tenant_id: str,
    actor: str,
    action: str,
    target: str,
    status: str,
    detail: str,
) -> AuditLog:
    record = AuditLogRecord(
        id=f"audit_{uuid4().hex[:12]}",
        tenant_id=tenant_id,
        actor=actor,
        action=action,
        target=target,
        status=status,
        detail=detail,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return audit_from_record(record)


def list_audit_logs(db: Session, tenant_id: str = TENANT_ID, *, limit: int = 50, offset: int = 0) -> list[AuditLog]:
    records = db.scalars(
        select(AuditLogRecord)
        .where(AuditLogRecord.tenant_id == tenant_id)
        .order_by(AuditLogRecord.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [audit_from_record(record) for record in records]


def audit_logs_to_csv(logs: list[AuditLog]) -> str:
    output = StringIO()
    writer = DictWriter(output, fieldnames=["id", "tenant_id", "actor", "action", "target", "status", "detail", "created_at"])
    writer.writeheader()
    for log in logs:
        writer.writerow(log.model_dump())
    return output.getvalue()


def build_admin_summary(db: Session, tenant_id: str = TENANT_ID) -> AdminSummary:
    tenant = get_tenant(tenant_id) or get_tenant(TENANT_ID) or TENANTS[0]
    approvals = list_approvals(db, tenant_id)
    runs = list_agent_runs(db, tenant_id)

    return AdminSummary(
        tenant_id=tenant_id,
        tenant_name=tenant.name,
        tenant_count=len(TENANTS),
        agents=len(list_agents(db, tenant_id)),
        events=len(list_stream_events(db, tenant_id)),
        documents=len(list_documents(db, tenant_id)),
        approvals_pending=sum(1 for approval in approvals if approval.status == "pending"),
        runs=len(runs),
        integrations_configured=tenant.integration_count,
        token_spend_cents=sum(run.token_cost_cents for run in runs),
    )


def create_onboarding_dry_run(
    db: Session,
    *,
    payload: OnboardingRequest,
    actor: str,
    tenant_id: str = TENANT_ID,
) -> OnboardingResult:
    checklist = [
        f"Create tenant workspace for {payload.company_name}",
        f"Invite admin {payload.admin_email}",
        f"Connect first data source: {payload.first_data_source}",
        f"Prepare template {payload.first_agent_template_id} for governed deployment",
        "Enable JWT, RBAC, audit logging, and approval policy",
    ]
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=actor,
        action="onboarding.dry_run",
        target=payload.company_name,
        status="ready",
        detail="; ".join(checklist),
    )
    return OnboardingResult(
        tenant_name=payload.company_name,
        admin_email=payload.admin_email,
        recommended_template_id=payload.first_agent_template_id,
        checklist=checklist,
        status="ready",
    )


def build_security_summary(db: Session, tenant_id: str = TENANT_ID) -> SecuritySummary:
    logs = list_audit_logs(db, tenant_id)
    security_logs = [
        log for log in logs
        if any(token in log.action for token in ["auth", "approval", "integration", "tenant", "onboarding", "document"])
    ][:12]
    events = [
        SecurityEvent(
            id=log.id,
            severity="high" if "rejected" in log.status or "deleted" in log.status else "medium" if "integration" in log.action else "low",
            actor=log.actor,
            action=log.action,
            target=log.target,
            status=log.status,
            detail=log.detail,
            created_at=log.created_at,
        )
        for log in security_logs
    ]
    api_keys_configured = sum(
        1
        for value in [
            settings.groq_api_key,
            settings.openai_api_key,
            settings.anthropic_api_key,
            settings.slack_webhook_url,
            settings.github_token,
            settings.pagerduty_routing_key,
        ]
        if value
    )
    risky_permissions = sum(1 for approval in list_approvals(db, tenant_id) if approval.risk.lower() == "high" and approval.status == "pending")
    return SecuritySummary(
        tenant_id=tenant_id,
        failed_logins=0,
        active_sessions=1,
        risky_permissions=risky_permissions,
        api_keys_configured=api_keys_configured,
        events=events,
    )


def build_roi_summary(db: Session, tenant_id: str = TENANT_ID) -> RoiSummary:
    runs = list_agent_runs(db, tenant_id)
    approvals = list_approvals(db, tenant_id)
    events = list_stream_events(db, tenant_id)
    incidents_avoided = max(1, sum(1 for event in events if event.severity.lower() in {"critical", "high"}))
    hours_saved = round((len(runs) * 1.4) + (len(approvals) * 0.45) + incidents_avoided * 2.25, 1)
    approval_minutes_saved = len(approvals) * 18
    agent_run_cost_cents = sum(run.token_cost_cents for run in runs)
    estimated_monthly_value = int((hours_saved * 125) + (incidents_avoided * 850) - (agent_run_cost_cents / 100))
    return RoiSummary(
        tenant_id=tenant_id,
        incidents_avoided=incidents_avoided,
        hours_saved=hours_saved,
        approval_minutes_saved=approval_minutes_saved,
        estimated_monthly_value=max(estimated_monthly_value, 0),
        agent_run_cost_cents=agent_run_cost_cents,
        top_workflows=[
            "Incident triage and runbook retrieval",
            "Human approval evidence collection",
            "Customer impact communication review",
            "Integration dry-runs before live actions",
        ],
    )


def seed_database(db: Session) -> None:
    if not db.scalars(select(UserRecord)).first():
        users = [
            ("user_admin", "admin@aiopshub.local", "Vivek Admin", "Admin", "admin123"),
            ("user_sre", "sre@aiopshub.local", "Sam SRE", "SRE", "sre123"),
            ("user_support", "support@aiopshub.local", "Priya Support", "Support Lead", "support123"),
            ("user_viewer", "viewer@aiopshub.local", "Riley Viewer", "Viewer", "viewer123"),
        ]
        db.add_all(
            [
                UserRecord(
                    id=user_id,
                    email=email,
                    name=name,
                    global_role=role,
                    password_hash=hash_password(password),
                )
                for user_id, email, name, role, password in users
            ]
        )
        db.add_all(
            [
                TenantMembershipRecord(id="membership_admin_northstar", user_id="user_admin", tenant_id="tenant_northstar_health", role="Admin"),
                TenantMembershipRecord(id="membership_admin_acme", user_id="user_admin", tenant_id="tenant_acme_fintech", role="Admin"),
                TenantMembershipRecord(id="membership_admin_cloudcart", user_id="user_admin", tenant_id="tenant_cloudcart_retail", role="Admin"),
                TenantMembershipRecord(id="membership_sre_northstar", user_id="user_sre", tenant_id="tenant_northstar_health", role="SRE"),
                TenantMembershipRecord(id="membership_sre_acme", user_id="user_sre", tenant_id="tenant_acme_fintech", role="SRE"),
                TenantMembershipRecord(id="membership_support_northstar", user_id="user_support", tenant_id="tenant_northstar_health", role="Support Lead"),
                TenantMembershipRecord(id="membership_support_cloudcart", user_id="user_support", tenant_id="tenant_cloudcart_retail", role="Support Lead"),
                TenantMembershipRecord(id="membership_viewer_northstar", user_id="user_viewer", tenant_id="tenant_northstar_health", role="Viewer"),
            ]
        )

    seed_sets = [
        (
            "tenant_northstar_health",
            "Northstar Health",
            [
                ("agent_incident", "Incident Triage Agent", "SRE / Platform", "anthropic:claude-3-5-sonnet", "deployed", 5000, ["runbook_rag", "sql_diagnostics", "pagerduty_mcp", "slack_draft"], ["approval_for_restart", "cite_sources", "tenant_scope_only"]),
                ("agent_revenue", "Revenue Risk Agent", "Finance Operations", "openai:gpt-4o-mini", "deployed", 3500, ["stripe_events", "crm_query", "anomaly_detector", "approval_gate"], ["no_customer_email_without_approval", "pii_redaction"]),
            ],
            [
                ("evt_1092", "platform.latency", "critical", "Checkout API P95 crossed 800ms for enterprise tenant.", "agent_incident", 0.91),
                ("evt_1091", "billing.failures", "high", "Payment retry failures increased after gateway deploy.", "agent_revenue", 0.88),
            ],
            [
                ("approval_restart_checkout", "Restart checkout-worker deployment", "high", "Agent matched pool exhaustion runbook with high confidence."),
            ],
            {
                "doc_checkout_runbook": ("Checkout Latency Runbook", "markdown", "When checkout latency rises, inspect database connection pools, slow queries, worker saturation, and recent gateway deploys."),
                "doc_escalation_policy": ("Enterprise Escalation Policy", "policy", "High-risk infrastructure actions require SRE approval. External customer notices require support lead review."),
            },
        ),
        (
            "tenant_acme_fintech",
            "Acme Fintech",
            [
                ("agent_acme_incident", "Ledger Incident Agent", "Payments / Ledger", "groq:llama-3.3-70b", "deployed", 8000, ["ledger_rag", "github_issue", "pagerduty_event"], ["dual_control", "tenant_scope_only"]),
                ("agent_acme_revenue", "Fraud Risk Agent", "Risk Operations", "local:fallback", "approval", 6200, ["risk_queue", "slack_brief", "audit_export"], ["pii_redaction", "manual_approval"]),
            ],
            [
                ("evt_acme_901", "payments.ledger", "critical", "Ledger settlement lag crossed SLA for card payouts.", "agent_acme_incident", 0.89),
                ("evt_acme_902", "fraud.velocity", "medium", "Fraud velocity increased in a high-value merchant segment.", "agent_acme_revenue", 0.74),
            ],
            [
                ("approval_acme_ledger", "Open PagerDuty incident for settlement lag", "high", "Agent detected a payout SLA breach requiring payments lead review."),
            ],
            {
                "doc_acme_ledger": ("Ledger Settlement Runbook", "markdown", "When settlement lag increases, inspect ledger queue depth, reconciliation workers, and recent payout service deploys."),
                "doc_acme_policy": ("Payments Escalation Policy", "policy", "Payout incidents require payments SRE approval and finance stakeholder notification before customer messaging."),
            },
        ),
        (
            "tenant_cloudcart_retail",
            "CloudCart Retail",
            [
                ("agent_cloudcart_incident", "Checkout Reliability Agent", "Commerce Platform", "groq:llama-3.3-70b", "deployed", 6500, ["checkout_rag", "slack_update", "github_issue"], ["approval_for_customer_notice", "cite_sources"]),
                ("agent_cloudcart_revenue", "Inventory Impact Agent", "Retail Operations", "local:fallback", "deployed", 4200, ["warehouse_events", "forecast_rag", "approval_gate"], ["no_external_action_without_approval"]),
            ],
            [
                ("evt_cloudcart_771", "checkout.errors", "high", "Checkout error rate spiked during flash sale traffic.", "agent_cloudcart_incident", 0.86),
                ("evt_cloudcart_772", "inventory.sync", "medium", "Inventory sync lag is delaying fulfillment promises.", "agent_cloudcart_revenue", 0.78),
            ],
            [
                ("approval_cloudcart_notice", "Send customer-facing checkout incident notice", "medium", "Agent drafted a customer update that requires support lead approval."),
            ],
            {
                "doc_cloudcart_checkout": ("Flash Sale Checkout Runbook", "markdown", "During flash sale checkout spikes, inspect payment gateway timeouts, cart service CPU, and Redis cache pressure."),
                "doc_cloudcart_support": ("Support Notice Policy", "policy", "Customer incident notices require support lead approval, incident commander sign-off, and source-backed impact details."),
            },
        ),
    ]

    for tenant_id, _tenant_name, agent_specs, event_specs, approval_specs, documents in seed_sets:
        if db.scalars(select(AgentRecord).where(AgentRecord.tenant_id == tenant_id)).first():
            continue

        agents = [
            AgentRecord(
                id=agent_id,
                tenant_id=tenant_id,
                name=name,
                domain=domain,
                model_provider=model_provider,
                status=status,
                budget_cents=budget_cents,
                tools_json=json.dumps(tools),
                guardrails_json=json.dumps(guardrails),
            )
            for agent_id, name, domain, model_provider, status, budget_cents, tools, guardrails in agent_specs
        ]
        events = [
            EventRecord(
                id=event_id,
                tenant_id=tenant_id,
                topic=topic,
                severity=severity,
                summary=summary,
                assigned_agent_id=assigned_agent_id,
                confidence=confidence,
            )
            for event_id, topic, severity, summary, assigned_agent_id, confidence in event_specs
        ]
        approvals = [
            ApprovalRecord(
                id=approval_id,
                tenant_id=tenant_id,
                action=action,
                risk=risk,
                reason=reason,
            )
            for approval_id, action, risk, reason in approval_specs
        ]
        db.add_all(agents + events + approvals)
        for document_id, (title, source_type, content) in documents.items():
            db.add(
                DocumentRecord(
                    id=document_id,
                    tenant_id=tenant_id,
                    title=title,
                    source_type=source_type,
                    content=content,
                )
            )
            for index, chunk in enumerate(chunk_text(content)):
                db.add(
                    DocumentChunkRecord(
                        id=f"{document_id}_chunk_{index}",
                        tenant_id=tenant_id,
                        document_id=document_id,
                        chunk_index=index,
                        text=chunk,
                        embedding_json=json.dumps(embed_text(chunk)),
                    )
                )
        db.add(
            AuditLogRecord(
                id=f"audit_seed_{tenant_id}",
                tenant_id=tenant_id,
                actor="system",
                action="tenant.seeded",
                target=tenant_id,
                status="completed",
                detail="Seeded tenant agents, stream events, approvals, and knowledge documents.",
            )
        )
    db.commit()
    refresh_document_embedding_dimensions(db)
