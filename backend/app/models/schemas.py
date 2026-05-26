from enum import Enum

from pydantic import BaseModel, Field


class AgentStatus(str, Enum):
    deployed = "deployed"
    approval = "approval"
    training = "training"


class Agent(BaseModel):
    id: str
    tenant_id: str
    name: str
    domain: str
    model_provider: str
    status: AgentStatus
    budget_cents: int = Field(gt=0)
    tools: list[str]
    guardrails: list[str]


class StreamEvent(BaseModel):
    id: str
    tenant_id: str
    topic: str
    severity: str
    summary: str
    assigned_agent_id: str
    confidence: float = Field(ge=0, le=1)


class StreamEventCreate(BaseModel):
    topic: str
    severity: str
    summary: str
    assigned_agent_id: str
    confidence: float = Field(ge=0, le=1)


class Tenant(BaseModel):
    id: str
    name: str
    industry: str
    plan: str
    region: str
    budget_cents: int
    provider_mode: str
    user_count: int
    integration_count: int


class TenantMembership(BaseModel):
    tenant_id: str
    role: str


class AuthUser(BaseModel):
    id: str
    email: str
    name: str
    role: str
    memberships: list[TenantMembership]


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthSession(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str
    user: AuthUser


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetStartResponse(BaseModel):
    status: str
    message: str
    reset_token: str | None = None
    expires_at: str | None = None


class PasswordResetConfirmRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class PasswordResetConfirmResponse(BaseModel):
    status: str
    message: str


class AdminSummary(BaseModel):
    tenant_id: str
    tenant_name: str
    tenant_count: int
    agents: int
    events: int
    documents: int
    approvals_pending: int
    runs: int
    integrations_configured: int
    token_spend_cents: int


class AuditLog(BaseModel):
    id: str
    tenant_id: str
    actor: str
    action: str
    target: str
    status: str
    detail: str
    created_at: str


class IntegrationStatus(BaseModel):
    id: str
    name: str
    configured: bool
    mode: str
    description: str
    last_result: str


class IntegrationActionRequest(BaseModel):
    summary: str
    target: str | None = None


class IntegrationActionResult(BaseModel):
    integration_id: str
    mode: str
    status: str
    message: str
    payload: dict[str, object]


class OnboardingRequest(BaseModel):
    company_name: str
    industry: str
    admin_email: str
    first_agent_template_id: str
    first_data_source: str


class OnboardingResult(BaseModel):
    tenant_name: str
    admin_email: str
    recommended_template_id: str
    checklist: list[str]
    status: str


class AgentTemplate(BaseModel):
    id: str
    name: str
    category: str
    description: str
    model_provider: str
    tools: list[str]
    guardrails: list[str]
    estimated_cost_cents: int
    required_role: str
    deploy_status: str = "available"


class AgentTemplateDeployResult(BaseModel):
    template_id: str
    agent_id: str
    tenant_id: str
    status: str
    message: str


class SecurityEvent(BaseModel):
    id: str
    severity: str
    actor: str
    action: str
    target: str
    status: str
    detail: str
    created_at: str


class SecuritySummary(BaseModel):
    tenant_id: str
    failed_logins: int
    active_sessions: int
    risky_permissions: int
    api_keys_configured: int
    events: list[SecurityEvent]


class RoiSummary(BaseModel):
    tenant_id: str
    incidents_avoided: int
    hours_saved: float
    approval_minutes_saved: int
    estimated_monthly_value: int
    agent_run_cost_cents: int
    top_workflows: list[str]


class RagSource(BaseModel):
    title: str
    source_type: str
    relevance: float = Field(ge=0, le=1)
    chunk_count: int


class ApprovalRequest(BaseModel):
    id: str
    tenant_id: str
    action: str
    risk: str
    reason: str
    status: str = "pending"


class AgentRun(BaseModel):
    id: str
    tenant_id: str
    agent_id: str
    event_id: str
    latency_ms: int
    token_cost_cents: int
    confidence: float
    sources: list[RagSource]
    approval_required: bool
    recommended_action: str


class TraceStep(BaseModel):
    title: str
    detail: str
    status: str = "completed"
    evidence: str


class AgentTrace(BaseModel):
    id: str
    tenant_id: str
    run_id: str
    event_id: str
    agent_id: str
    risk: str
    confidence: float
    approval_required: bool
    steps: list[TraceStep]


class Document(BaseModel):
    id: str
    tenant_id: str
    title: str
    source_type: str
    chunk_count: int


class DocumentChunk(BaseModel):
    id: str
    tenant_id: str
    document_id: str
    text: str
    embedding: list[float]


class DocumentUploadResult(BaseModel):
    id: str
    tenant_id: str
    title: str
    source_type: str
    chunk_count: int


class RetrievalResult(BaseModel):
    document_id: str
    chunk_id: str
    title: str
    source_type: str
    score: float
    text: str


class RetrievalResponse(BaseModel):
    query: str
    answer: str
    provider: str
    confidence: float
    sources: list[RetrievalResult]


class ChatRequest(BaseModel):
    prompt: str
    provider: str = "local"


class ChatResponse(BaseModel):
    provider: str
    model: str
    content: str
    token_cost_cents: int


class ProviderStatus(BaseModel):
    id: str
    label: str
    model: str
    available: bool
    mode: str


class ProviderConfig(BaseModel):
    selected_provider: str
    providers: list[ProviderStatus]
