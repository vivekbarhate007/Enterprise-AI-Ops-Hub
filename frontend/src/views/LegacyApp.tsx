import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Activity,
  Bell,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDollarSign,
  Command,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSearch,
  GitBranch,
  Github,
  KeyRound,
  Layers3,
  LockKeyhole,
  Play,
  RefreshCcw,
  RadioTower,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UsersRound,
  Workflow,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { agents, capabilities, flow, metrics } from "../data";

type ViewName =
  | "Command Center"
  | "Executive Demo"
  | "Agent Builder"
  | "Knowledge Base"
  | "Approvals"
  | "Streaming"
  | "Marketplace"
  | "ROI"
  | "Security Center"
  | "Admin Console"
  | "Settings";

type ProviderName = "local" | "groq" | "openai" | "anthropic";
type UserRole = "Admin" | "SRE" | "Support Lead" | "Viewer";

type KnowledgeSource = {
  document_id: string;
  chunk_id: string;
  title: string;
  source_type: string;
  score: number;
  text: string;
};

type KnowledgeAnswer = {
  query: string;
  answer: string;
  provider: string;
  confidence: number;
  sources: KnowledgeSource[];
};

type DocumentUploadResult = {
  id: string;
  tenant_id: string;
  title: string;
  source_type: string;
  chunk_count: number;
};

type IndexedDocument = DocumentUploadResult;

type BackendEvent = {
  id: string;
  tenant_id: string;
  topic: string;
  severity: string;
  summary: string;
  assigned_agent_id: string;
  confidence: number;
};

type AgentRunResult = {
  id: string;
  tenant_id: string;
  agent_id: string;
  event_id: string;
  latency_ms: number;
  token_cost_cents: number;
  confidence: number;
  sources: Array<{
    title: string;
    source_type: string;
    relevance: number;
    chunk_count: number;
  }>;
  approval_required: boolean;
  recommended_action: string;
};

type AgentTrace = {
  id: string;
  tenant_id: string;
  run_id: string;
  event_id: string;
  agent_id: string;
  risk: string;
  confidence: number;
  approval_required: boolean;
  steps: Array<{
    title: string;
    detail: string;
    status: string;
    evidence: string;
  }>;
};

type BackendApproval = {
  id: string;
  tenant_id: string;
  action: string;
  risk: string;
  reason: string;
  status: string;
};

type ProviderConfig = {
  selected_provider: ProviderName;
  providers: Array<{
    id: ProviderName;
    label: string;
    model: string;
    available: boolean;
    mode: string;
  }>;
};

type TenantMembership = {
  tenant_id: string;
  role: UserRole;
};

type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  memberships: TenantMembership[];
};

type AuthSession = {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: AuthUser;
};

type PasswordResetStartResponse = {
  status: string;
  message: string;
  reset_token?: string | null;
  expires_at?: string | null;
};

type Tenant = {
  id: string;
  name: string;
  industry: string;
  plan: string;
  region: string;
  budget_cents: number;
  provider_mode: string;
  user_count: number;
  integration_count: number;
};

type AdminSummary = {
  tenant_id: string;
  tenant_name: string;
  tenant_count: number;
  agents: number;
  events: number;
  documents: number;
  approvals_pending: number;
  runs: number;
  integrations_configured: number;
  token_spend_cents: number;
};

type AuditLog = {
  id: string;
  tenant_id: string;
  actor: string;
  action: string;
  target: string;
  status: string;
  detail: string;
  created_at: string;
};

type IntegrationStatus = {
  id: "slack" | "github" | "pagerduty";
  name: string;
  configured: boolean;
  mode: string;
  description: string;
  last_result: string;
};

type IntegrationActionResult = {
  integration_id: string;
  mode: string;
  status: string;
  message: string;
  payload: Record<string, unknown>;
};

type AgentTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  model_provider: string;
  tools: string[];
  guardrails: string[];
  estimated_cost_cents: number;
  required_role: string;
  deploy_status: string;
};

type AgentTemplateDeployResult = {
  template_id: string;
  agent_id: string;
  tenant_id: string;
  status: string;
  message: string;
};

type OnboardingResult = {
  tenant_name: string;
  admin_email: string;
  recommended_template_id: string;
  checklist: string[];
  status: string;
};

type SecuritySummary = {
  tenant_id: string;
  failed_logins: number;
  active_sessions: number;
  risky_permissions: number;
  api_keys_configured: number;
  events: Array<{
    id: string;
    severity: string;
    actor: string;
    action: string;
    target: string;
    status: string;
    detail: string;
    created_at: string;
  }>;
};

type RoiSummary = {
  tenant_id: string;
  incidents_avoided: number;
  hours_saved: number;
  approval_minutes_saved: number;
  estimated_monthly_value: number;
  agent_run_cost_cents: number;
  top_workflows: string[];
};

const API_BASE_URLS = ["http://127.0.0.1:8000/api/v1", "http://localhost:8000/api/v1"];
const STREAM_URLS = ["ws://127.0.0.1:8000/api/v1/stream", "ws://localhost:8000/api/v1/stream"];
const AUTH_STORAGE_KEY = "enterprise-ai-ops-hub-auth";
let apiAccessToken = "";

function setApiAccessToken(token: string) {
  apiAccessToken = token;
}

function normalizeSeverity(severity: string) {
  const normalized = severity.trim().toLowerCase();
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` as keyof typeof severityClass;
}

async function apiFetch(path: string, init?: RequestInit) {
  let lastError: unknown;

  for (const baseUrl of API_BASE_URLS) {
    try {
      const headers = new Headers(init?.headers);

      if (apiAccessToken) {
        headers.set("Authorization", `Bearer ${apiAccessToken}`);
      }

      const response = await fetch(`${baseUrl}${path}`, { ...init, credentials: "include", headers });

      if (response.ok) {
        return response;
      }

      lastError = new Error(`${baseUrl} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Backend API is not reachable. Make sure FastAPI is running on port 8000.");
}

function apiUrl(path: string) {
  return `${API_BASE_URLS[0]}${path}`;
}

function readStoredAuthSession() {
  try {
    const legacy = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (legacy) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.sessionStorage.setItem(AUTH_STORAGE_KEY, legacy);
    }
    const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (!session.expires_at || Date.parse(session.expires_at) <= Date.now()) {
      window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function apiErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown request error";

  if (message.toLowerCase().includes("failed to fetch")) {
    return "Browser could not connect to FastAPI. Keep the backend running on port 8000, then refresh this page.";
  }

  return message;
}

async function parseApiJson<T>(response: Response) {
  return (await response.json()) as T;
}

function mergeEvents(current: BackendEvent[], incoming: BackendEvent[]) {
  const byId = new Map(current.map((event) => [event.id, event]));

  for (const event of incoming) {
    byId.set(event.id, event);
  }

  return Array.from(byId.values());
}

const severityClass = {
  Critical: "critical",
  High: "high",
  Medium: "medium",
  Low: "low"
};

const fallbackTraceSteps: AgentTrace["steps"] = [
  {
    title: "Event received",
    detail: "Kafka event was routed into the incident agent lane.",
    status: "completed",
    evidence: "Demo event evt-1092 matched platform.latency."
  },
  {
    title: "Knowledge retrieved",
    detail: "The agent retrieved operational runbooks and RCA notes.",
    status: "completed",
    evidence: "49 chunks searched from pgvector."
  },
  {
    title: "Risk evaluated",
    detail: "Severity and confidence required a human approval gate.",
    status: "completed",
    evidence: "Critical severity triggered high-risk policy."
  },
  {
    title: "Action recommended",
    detail: "The agent prepared a staged recovery recommendation.",
    status: "completed",
    evidence: "Restart requires SRE approval."
  }
];

const navItems: Array<[ViewName, LucideIcon]> = [
  ["Command Center", Activity],
  ["Executive Demo", Command],
  ["Agent Builder", BrainCircuit],
  ["Knowledge Base", FileSearch],
  ["Approvals", ShieldCheck],
  ["Streaming", RadioTower],
  ["Marketplace", Sparkles],
  ["ROI", CircleDollarSign],
  ["Security Center", LockKeyhole],
  ["Admin Console", UsersRound]
];

const viewCopy: Record<ViewName, { eyebrow: string; title: string; summary: string }> = {
  "Command Center": {
    eyebrow: "Production Command Center",
    title: "Autonomous agents with enterprise-grade control.",
    summary: "Monitor live business events, agent decisions, retrieval quality, cost, and approval gates from one command surface."
  },
  "Executive Demo": {
    eyebrow: "Executive Demo Flow",
    title: "One incident, fully governed from signal to action.",
    summary: "Walk through the exact enterprise AI loop recruiters and senior engineers expect: event, agent reasoning, RAG evidence, approval, audit, and business impact."
  },
  "Agent Builder": {
    eyebrow: "Agent Builder",
    title: "Design, govern, and deploy AI workers.",
    summary: "Configure model routing, tools, budgets, tenant permissions, and safety policies before any agent reaches production."
  },
  "Knowledge Base": {
    eyebrow: "RAG Knowledge Base",
    title: "Ground every answer in trusted tenant knowledge.",
    summary: "Upload enterprise content, chunk it, embed it, retrieve sources, and answer with citations instead of guesswork."
  },
  Approvals: {
    eyebrow: "Human-In-The-Loop",
    title: "Review high-impact actions before execution.",
    summary: "Give teams a calm, auditable place to approve or reject infrastructure, customer, and financial actions."
  },
  Streaming: {
    eyebrow: "Real-Time Event Mesh",
    title: "Watch Kafka events flow into policy-aware agents.",
    summary: "Track the event topics, severity, confidence, and routing rules that decide which agent should respond."
  },
  Marketplace: {
    eyebrow: "Agent Marketplace",
    title: "Deploy governed AI workers from production templates.",
    summary: "Package the platform as a product: pick a template, inspect tools and guardrails, then deploy it into the active tenant."
  },
  ROI: {
    eyebrow: "Executive ROI",
    title: "Show the business value behind every autonomous workflow.",
    summary: "Translate agent runs, approvals, incident prevention, and cost controls into a founder-friendly value story."
  },
  "Security Center": {
    eyebrow: "Security Center",
    title: "Prove access control, API key posture, and audit readiness.",
    summary: "Review risky permissions, security-relevant events, API key coverage, and tenant access from one trust surface."
  },
  "Admin Console": {
    eyebrow: "SaaS Administration",
    title: "Manage tenants, integrations, and audit evidence.",
    summary: "Switch tenants, inspect operational health, run dry/live integration checks, and export audit logs for company-ready proof."
  },
  Settings: {
    eyebrow: "Enterprise Controls",
    title: "Budgets, providers, guardrails, and tenant policy.",
    summary: "Control architecture, provider fallback, spend limits, and deployment readiness from a production-minded settings area."
  }
};

export function LegacyApp() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => readStoredAuthSession());
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setLoggingIn] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [isResettingPassword, setResettingPassword] = useState(false);
  const [activeView, setActiveView] = useState<ViewName>("Command Center");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState("tenant_northstar_health");
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [adminError, setAdminError] = useState("");
  const [integrationActionId, setIntegrationActionId] = useState<string | null>(null);
  const [integrationResult, setIntegrationResult] = useState<IntegrationActionResult | null>(null);
  const [onboardingResult, setOnboardingResult] = useState<OnboardingResult | null>(null);
  const [onboardingError, setOnboardingError] = useState("");
  const [isOnboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingDraft, setOnboardingDraft] = useState({
    company_name: "HelioPay",
    industry: "Fintech",
    admin_email: "founder@heliopay.local",
    first_agent_template_id: "tpl_incident_triage",
    first_data_source: "checkout-latency-runbook.md"
  });
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([]);
  const [marketplaceError, setMarketplaceError] = useState("");
  const [isTemplatesLoading, setTemplatesLoading] = useState(false);
  const [templateActionId, setTemplateActionId] = useState<string | null>(null);
  const [templateDeployResult, setTemplateDeployResult] = useState<AgentTemplateDeployResult | null>(null);
  const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null);
  const [securityError, setSecurityError] = useState("");
  const [roiSummary, setRoiSummary] = useState<RoiSummary | null>(null);
  const [roiError, setRoiError] = useState("");
  const [query, setQuery] = useState("");
  const [isDeployOpen, setDeployOpen] = useState(false);
  const [isTraceOpen, setTraceOpen] = useState(false);
  const [notice, setNotice] = useState("All systems nominal. No unread critical approvals.");
  const [approvals, setApprovals] = useState<BackendApproval[]>([]);
  const [isApprovalsLoading, setApprovalsLoading] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [approvalActionId, setApprovalActionId] = useState<string | null>(null);
  const [knowledgeQuestion, setKnowledgeQuestion] = useState("Why is checkout latency high?");
  const [knowledgeAnswer, setKnowledgeAnswer] = useState<KnowledgeAnswer | null>(null);
  const [isKnowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<DocumentUploadResult | null>(null);
  const [isUploadingDocument, setUploadingDocument] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [indexedDocuments, setIndexedDocuments] = useState<IndexedDocument[]>([]);
  const [isDocumentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [documentActionId, setDocumentActionId] = useState<string | null>(null);
  const [backendEvents, setBackendEvents] = useState<BackendEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [agentRun, setAgentRun] = useState<AgentRunResult | null>(null);
  const [agentTrace, setAgentTrace] = useState<AgentTrace | null>(null);
  const [isTraceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState("");
  const [isEventsLoading, setEventsLoading] = useState(false);
  const [isAgentRunning, setAgentRunning] = useState(false);
  const [agentRunError, setAgentRunError] = useState("");
  const [eventDraft, setEventDraft] = useState({
    topic: "platform.latency",
    severity: "critical",
    summary: "Checkout API P95 crossed 800ms for enterprise tenant.",
    assigned_agent_id: "agent_incident",
    confidence: 0.91
  });
  const [isCreatingEvent, setCreatingEvent] = useState(false);
  const [eventCreateError, setEventCreateError] = useState("");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "connected" | "synced" | "fallback" | "disconnected">("connecting");
  const [streamError, setStreamError] = useState("");
  const [streamReconnectKey, setStreamReconnectKey] = useState(0);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>("local");
  const [providerError, setProviderError] = useState("");
  const [currentRole, setCurrentRole] = useState<UserRole>("Admin");
  const [executiveStep, setExecutiveStep] = useState(0);
  const [isExecutiveRunning, setExecutiveRunning] = useState(false);
  const streamUrlIndexRef = useRef(0);
  const activeTenant = tenants.find((tenant) => tenant.id === activeTenantId) ?? tenants[0];

  const tenantPath = (path: string) =>
    `${path}${path.includes("?") ? "&" : "?"}tenant_id=${encodeURIComponent(activeTenantId)}`;

  const normalizedQuery = query.trim().toLowerCase();
  const canDeploy = currentRole === "Admin";
  const canManageDocs = currentRole === "Admin" || currentRole === "SRE";
  const canCreateEvents = currentRole === "Admin" || currentRole === "SRE";
  const canRunAgents = currentRole === "Admin" || currentRole === "SRE" || currentRole === "Support Lead";
  const canChangeProvider = currentRole === "Admin";

  const canDecideApproval = (approval: BackendApproval) => {
    const action = approval.action.toLowerCase();
    if (currentRole === "Admin") return true;
    if (currentRole === "SRE") return action.includes("restart") || action.includes("worker") || action.includes("deployment");
    if (currentRole === "Support Lead") return action.includes("customer") || action.includes("support") || action.includes("notice");
    return false;
  };

  const blockedReason = (action: string) => `${currentRole} role can inspect this area, but cannot ${action}. Switch role in Settings to test RBAC.`;

  const login = async (email: string, password: string) => {
    setLoggingIn(true);
    setLoginError("");
    setApiAccessToken("");

    try {
      const response = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const session = await parseApiJson<AuthSession>(response);
      setAuthSession(session);
      setApiAccessToken(session.access_token);
      window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      setCurrentRole(session.user.role);
      setNotice(`Signed in as ${session.user.name}. Backend RBAC is active.`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setLoginError(`Could not sign in. ${message}`);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = () => {
    void apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
    setApiAccessToken("");
    setAuthSession(null);
    setTenants([]);
    setBackendEvents([]);
    setIndexedDocuments([]);
    setApprovals([]);
    setNotice("Signed out.");
  };

  const requestPasswordReset = async (email: string) => {
    setResettingPassword(true);
    setLoginError("");
    setResetMessage("");
    setResetToken("");

    try {
      const response = await apiFetch("/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const payload = await parseApiJson<PasswordResetStartResponse>(response);
      setResetMessage(payload.message);
      if (payload.reset_token) {
        setResetToken(payload.reset_token);
      }
    } catch (error) {
      setLoginError(`Could not start reset. ${apiErrorMessage(error)}`);
    } finally {
      setResettingPassword(false);
    }
  };

  const confirmPasswordReset = async (token: string, newPassword: string) => {
    setResettingPassword(true);
    setLoginError("");

    try {
      const response = await apiFetch("/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: newPassword })
      });
      const payload = await parseApiJson<{ message: string }>(response);
      setResetMessage(payload.message);
      setResetToken("");
    } catch (error) {
      setLoginError(`Could not reset password. ${apiErrorMessage(error)}`);
    } finally {
      setResettingPassword(false);
    }
  };

  const filteredAgents = useMemo(
    () =>
      agents.filter((agent) =>
        [agent.name, agent.domain, agent.model, ...agent.tools]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      ),
    [normalizedQuery]
  );

  const filteredBackendEvents = useMemo(
    () =>
      backendEvents.filter((event) =>
        [event.summary, event.topic, event.assigned_agent_id, event.severity, event.id]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      ),
    [backendEvents, normalizedQuery]
  );

  const askKnowledgeBase = async (questionOverride?: string) => {
    const question = (questionOverride ?? knowledgeQuestion).trim();

    if (!question) {
      setKnowledgeError("Type a question before asking the knowledge base.");
      return;
    }

    setKnowledgeQuestion(question);
    setKnowledgeLoading(true);
    setKnowledgeError("");

    try {
      const response = await apiFetch(tenantPath(`/rag/query?query=${encodeURIComponent(question)}&provider=${encodeURIComponent(selectedProvider)}`));
      const payload = await parseApiJson<KnowledgeAnswer>(response);
      setKnowledgeAnswer(payload);
      setNotice(`Knowledge answer generated from ${payload.sources.length} cited source${payload.sources.length === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setKnowledgeError(`Could not reach the knowledge API. ${message}`);
    } finally {
      setKnowledgeLoading(false);
    }
  };

  const handleUploadFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUploadFile(event.target.files?.[0] ?? null);
    setUploadResult(null);
    setUploadError("");
  };

  const loadIndexedDocuments = async () => {
    setDocumentsLoading(true);
    setDocumentsError("");

    try {
      const response = await apiFetch(tenantPath("/documents"));
      const payload = await parseApiJson<IndexedDocument[]>(response);
      setIndexedDocuments(payload);
    } catch (error) {
      const message = apiErrorMessage(error);
      setDocumentsError(`Could not load indexed documents. ${message}`);
    } finally {
      setDocumentsLoading(false);
    }
  };

  const loadBackendEvents = async () => {
    setEventsLoading(true);
    setAgentRunError("");

    try {
      const response = await apiFetch(tenantPath("/events"));
      const payload = await parseApiJson<BackendEvent[]>(response);
      setBackendEvents(payload);
      setSelectedEventId((current) => current || payload[0]?.id || "");
    } catch (error) {
      const message = apiErrorMessage(error);
      setAgentRunError(`Could not load stream events. ${message}`);
    } finally {
      setEventsLoading(false);
    }
  };

  const loadApprovals = async () => {
    setApprovalsLoading(true);
    setApprovalError("");

    try {
      const response = await apiFetch(tenantPath("/approvals"));
      const payload = await parseApiJson<BackendApproval[]>(response);
      setApprovals(payload);
    } catch (error) {
      const message = apiErrorMessage(error);
      setApprovalError(`Could not load approvals. ${message}`);
    } finally {
      setApprovalsLoading(false);
    }
  };

  const loadProviderConfig = async () => {
    setProviderError("");

    try {
      const response = await apiFetch("/providers");
      const payload = await parseApiJson<ProviderConfig>(response);
      setProviderConfig(payload);
      setSelectedProvider(payload.selected_provider || "local");
    } catch (error) {
      const message = apiErrorMessage(error);
      setProviderError(`Could not load provider configuration. ${message}`);
    }
  };

  const loadTenants = async () => {
    setAdminError("");

    try {
      const response = await apiFetch("/tenants");
      const payload = await parseApiJson<Tenant[]>(response);
      setTenants(payload);
      setActiveTenantId((current) => payload.some((tenant) => tenant.id === current) ? current : payload[0]?.id ?? current);
    } catch (error) {
      const message = apiErrorMessage(error);
      setAdminError(`Could not load tenants. ${message}`);
    }
  };

  const loadAdminConsole = async () => {
    setAdminError("");

    if ((authSession?.user.role ?? currentRole) !== "Admin") {
      setAdminSummary(null);
      setAuditLogs([]);
      setIntegrations([]);
      setIntegrationResult(null);
      return;
    }

    try {
      const [summaryResponse, logsResponse, integrationsResponse] = await Promise.all([
        apiFetch(tenantPath("/admin/summary")),
        apiFetch(tenantPath("/audit-logs")),
        apiFetch("/integrations")
      ]);
      const [summaryPayload, logsPayload, integrationsPayload] = await Promise.all([
        parseApiJson<AdminSummary>(summaryResponse),
        parseApiJson<AuditLog[]>(logsResponse),
        parseApiJson<IntegrationStatus[]>(integrationsResponse)
      ]);
      setAdminSummary(summaryPayload);
      setAuditLogs(logsPayload);
      setIntegrations(integrationsPayload);
    } catch (error) {
      const message = apiErrorMessage(error);
      setAdminError(`Could not load admin console. ${message}`);
    }
  };

  const loadMarketplace = async () => {
    setTemplatesLoading(true);
    setMarketplaceError("");

    try {
      const response = await apiFetch(tenantPath("/agent-templates"));
      const payload = await parseApiJson<AgentTemplate[]>(response);
      setAgentTemplates(payload);
    } catch (error) {
      const message = apiErrorMessage(error);
      setMarketplaceError(`Could not load marketplace templates. ${message}`);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const deployTemplate = async (template: AgentTemplate) => {
    if (currentRole !== "Admin") {
      setMarketplaceError(blockedReason("deploy marketplace templates"));
      return;
    }

    setTemplateActionId(template.id);
    setMarketplaceError("");

    try {
      const response = await apiFetch(tenantPath(`/agent-templates/${template.id}/deploy`), { method: "POST" });
      const payload = await parseApiJson<AgentTemplateDeployResult>(response);
      setTemplateDeployResult(payload);
      await loadMarketplace();
      setNotice(payload.message);
    } catch (error) {
      const message = apiErrorMessage(error);
      setMarketplaceError(`Could not deploy ${template.name}. ${message}`);
    } finally {
      setTemplateActionId(null);
    }
  };

  const runOnboarding = async () => {
    if (currentRole !== "Admin") {
      setOnboardingError(blockedReason("create tenant onboarding plans"));
      return;
    }

    setOnboardingSaving(true);
    setOnboardingError("");

    try {
      const response = await apiFetch(tenantPath("/onboarding"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(onboardingDraft)
      });
      const payload = await parseApiJson<OnboardingResult>(response);
      setOnboardingResult(payload);
      await loadAdminConsole();
      setNotice(`${payload.tenant_name} onboarding plan is ready for buyer demo.`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setOnboardingError(`Could not create onboarding plan. ${message}`);
    } finally {
      setOnboardingSaving(false);
    }
  };

  const loadSecuritySummary = async () => {
    setSecurityError("");

    if (currentRole !== "Admin" && currentRole !== "SRE") {
      setSecuritySummary(null);
      return;
    }

    try {
      const response = await apiFetch(tenantPath("/security/summary"));
      const payload = await parseApiJson<SecuritySummary>(response);
      setSecuritySummary(payload);
    } catch (error) {
      const message = apiErrorMessage(error);
      setSecurityError(`Could not load security center. ${message}`);
    }
  };

  const loadRoiSummary = async () => {
    setRoiError("");

    try {
      const response = await apiFetch(tenantPath("/roi"));
      const payload = await parseApiJson<RoiSummary>(response);
      setRoiSummary(payload);
    } catch (error) {
      const message = apiErrorMessage(error);
      setRoiError(`Could not load ROI dashboard. ${message}`);
    }
  };

  const testIntegration = async (integration: IntegrationStatus) => {
    if ((authSession?.user.role ?? currentRole) !== "Admin") {
      setAdminError(blockedReason("test integrations"));
      return;
    }

    setIntegrationActionId(integration.id);
    setAdminError("");

    try {
      const response = await apiFetch(tenantPath(`/integrations/${integration.id}/test`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: `${activeTenant?.name ?? "Tenant"} AI Ops validation: checkout latency incident requires governed follow-up.`,
          target: integration.id === "slack" ? "#ai-ops-incidents" : integration.id === "github" ? "engineering/backlog" : "primary-on-call"
        })
      });
      const payload = await parseApiJson<IntegrationActionResult>(response);
      setIntegrationResult(payload);
      await loadAdminConsole();
      setNotice(`${integration.name}: ${payload.message}`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setAdminError(`Could not test ${integration.name}. ${message}`);
    } finally {
      setIntegrationActionId(null);
    }
  };

  const decideApproval = async (approval: BackendApproval, decision: "approve" | "reject") => {
    if (!canDecideApproval(approval)) {
      setApprovalError(blockedReason(`${decision} this approval`));
      return;
    }

    setApprovalActionId(approval.id);
    setApprovalError("");

    try {
      const response = await apiFetch(tenantPath(`/approvals/${approval.id}/${decision}`), { method: "POST" });
      const updated = await parseApiJson<BackendApproval>(response);
      setApprovals((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`${decision === "approve" ? "Approved" : "Rejected"}: ${updated.action}`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setApprovalError(`Could not ${decision} "${approval.action}". ${message}`);
    } finally {
      setApprovalActionId(null);
    }
  };

  const runSelectedAgent = async () => {
    if (!canRunAgents) {
      setAgentRunError(blockedReason("run agents"));
      return;
    }

    if (!selectedEventId) {
      setAgentRunError("Select an event before running an agent.");
      return;
    }

    setAgentRunning(true);
    setAgentRunError("");
    setTraceError("");
    setAgentTrace(null);

    try {
      const response = await apiFetch(tenantPath(`/events/${selectedEventId}/run`), { method: "POST" });
      const payload = await parseApiJson<AgentRunResult>(response);
      setAgentRun(payload);
      setNotice(`Agent run completed: ${Math.round(payload.confidence * 100)}% confidence, ${payload.latency_ms}ms latency.`);
      setTraceLoading(true);
      try {
        const traceResponse = await apiFetch(tenantPath(`/runs/${payload.id}/trace`));
        const tracePayload = await parseApiJson<AgentTrace>(traceResponse);
        setAgentTrace(tracePayload);
      } catch (traceLoadError) {
        const message = apiErrorMessage(traceLoadError);
        setTraceError(`Run completed, but trace could not load. ${message}`);
      }
    } catch (error) {
      const message = apiErrorMessage(error);
      setAgentRunError(`Could not run agent. ${message}`);
    } finally {
      setAgentRunning(false);
      setTraceLoading(false);
    }
  };

  const refreshRunTrace = async (runId: string) => {
    setTraceLoading(true);
    setTraceError("");

    try {
      const response = await apiFetch(tenantPath(`/runs/${runId}/trace`));
      const payload = await parseApiJson<AgentTrace>(response);
      setAgentTrace(payload);
    } catch (error) {
      const message = apiErrorMessage(error);
      setTraceError(`Could not load run trace. ${message}`);
    } finally {
      setTraceLoading(false);
    }
  };

  const createStreamEvent = async () => {
    if (!canCreateEvents) {
      setEventCreateError(blockedReason("create stream events"));
      return;
    }

    const summary = eventDraft.summary.trim();

    if (!summary) {
      setEventCreateError("Add an event summary before submitting.");
      return;
    }

    setCreatingEvent(true);
    setEventCreateError("");

    try {
      const response = await apiFetch(tenantPath("/events"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: eventDraft.topic,
          severity: eventDraft.severity,
          summary,
          assigned_agent_id: eventDraft.assigned_agent_id,
          confidence: eventDraft.confidence
        })
      });
      const created = await parseApiJson<BackendEvent>(response);
      setBackendEvents((current) => mergeEvents(current, [created]));
      setSelectedEventId(created.id);
      setEventDraft((current) => ({ ...current, summary: "" }));
      setNotice(`Created stream event ${created.id} and routed it to ${created.assigned_agent_id}.`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setEventCreateError(`Could not create event. ${message}`);
    } finally {
      setCreatingEvent(false);
    }
  };

  const uploadDocument = async () => {
    if (!canManageDocs) {
      setUploadError(blockedReason("upload documents"));
      return;
    }

    if (!uploadFile) {
      setUploadError("Choose a .txt or .md document before uploading.");
      return;
    }

    const formData = new FormData();
    formData.append("file", uploadFile);

    if (uploadTitle.trim()) {
      formData.append("title", uploadTitle.trim());
    }

    setUploadingDocument(true);
    setUploadError("");

    try {
      const response = await apiFetch(tenantPath("/documents/upload"), {
        method: "POST",
        body: formData
      });

      const payload = await parseApiJson<DocumentUploadResult>(response);
      setUploadResult(payload);
      setUploadTitle("");
      setUploadFile(null);
      await loadIndexedDocuments();
      setNotice(`Indexed "${payload.title}" into ${payload.chunk_count} searchable chunk${payload.chunk_count === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setUploadError(`Could not upload document. ${message}`);
    } finally {
      setUploadingDocument(false);
    }
  };

  const reindexDocument = async (document: IndexedDocument) => {
    if (!canManageDocs) {
      setDocumentsError(blockedReason("re-index documents"));
      return;
    }

    setDocumentActionId(document.id);
    setDocumentsError("");

    try {
      const response = await apiFetch(tenantPath(`/documents/${document.id}/reindex`), { method: "POST" });
      const payload = await parseApiJson<DocumentUploadResult>(response);
      await loadIndexedDocuments();
      setNotice(`Re-indexed "${payload.title}" into ${payload.chunk_count} searchable chunk${payload.chunk_count === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setDocumentsError(`Could not re-index "${document.title}". ${message}`);
    } finally {
      setDocumentActionId(null);
    }
  };

  const deleteDocument = async (document: IndexedDocument) => {
    if (!canManageDocs) {
      setDocumentsError(blockedReason("delete documents"));
      return;
    }

    const confirmed = window.confirm(`Delete "${document.title}" from the knowledge base?`);

    if (!confirmed) {
      return;
    }

    setDocumentActionId(document.id);
    setDocumentsError("");

    try {
      await apiFetch(tenantPath(`/documents/${document.id}`), { method: "DELETE" });
      setIndexedDocuments((current) => current.filter((item) => item.id !== document.id));
      setNotice(`Deleted "${document.title}" from the knowledge base.`);
    } catch (error) {
      const message = apiErrorMessage(error);
      setDocumentsError(`Could not delete "${document.title}". ${message}`);
    } finally {
      setDocumentActionId(null);
    }
  };

  useEffect(() => {
    if (!authSession) {
      setApiAccessToken("");
      return;
    }
    setApiAccessToken(authSession.access_token);
    setCurrentRole(authSession.user.role);
  }, [authSession]);

  useEffect(() => {
    if (!authSession) return;
    void loadTenants();
    void loadProviderConfig();
  }, [authSession]);

  useEffect(() => {
    if (!authSession) return;
    setBackendEvents([]);
    setSelectedEventId("");
    setAgentRun(null);
    setAgentTrace(null);
    setKnowledgeAnswer(null);
    setIntegrationResult(null);
    void loadIndexedDocuments();
    void loadBackendEvents();
    void loadApprovals();
    void loadAdminConsole();
    void loadMarketplace();
    void loadSecuritySummary();
    void loadRoiSummary();
  }, [activeTenantId, authSession, currentRole]);

  useEffect(() => {
    if (!isExecutiveRunning) return;
    setExecutiveStep(0);
    const timers = [1, 2, 3, 4, 5].map((step) =>
      window.setTimeout(() => setExecutiveStep(step), step * 650)
    );
    const doneTimer = window.setTimeout(() => {
      setExecutiveRunning(false);
      setNotice("Executive demo completed: event, RAG evidence, approval gate, and audit trail verified.");
    }, 4300);

    return () => {
      timers.forEach(window.clearTimeout);
      window.clearTimeout(doneTimer);
    };
  }, [isExecutiveRunning]);

  useEffect(() => {
    if (!authSession) return;
    let isCancelled = false;
    let socket: WebSocket | null = null;
    const streamUrl = `${STREAM_URLS[streamUrlIndexRef.current % STREAM_URLS.length]}?tenant_id=${encodeURIComponent(activeTenantId)}&token=${encodeURIComponent(authSession.access_token)}`;

    setStreamStatus("connecting");
    setStreamError("");

    try {
      socket = new WebSocket(streamUrl);
    } catch (error) {
      setStreamStatus("fallback");
      setStreamError(apiErrorMessage(error));
      void loadBackendEvents();
      return;
    }

    socket.onopen = () => {
      if (isCancelled) return;
      setStreamStatus("connected");
      setNotice("Streaming connection established. Backend events are live.");
    };

    socket.onmessage = (message) => {
      if (isCancelled) return;

      try {
        const payload = JSON.parse(message.data as string) as BackendEvent & { type?: string };
        if (payload.type === "ping") return;
        setBackendEvents((current) => mergeEvents(current, [payload]));
        setSelectedEventId((current) => current || payload.id);
      } catch {
        setStreamError("Received an unreadable event from the stream.");
      }
    };

    socket.onerror = () => {
      if (isCancelled) return;
      setStreamStatus("fallback");
      setStreamError("WebSocket failed. Showing REST event snapshot.");
      void loadBackendEvents();
    };

    socket.onclose = () => {
      if (isCancelled) return;
      setStreamStatus((current) => (current === "connected" ? "synced" : "fallback"));
      void loadBackendEvents();
    };

    return () => {
      isCancelled = true;
      socket?.close();
    };
  }, [streamReconnectKey, activeTenantId, authSession]);

  const page = viewCopy[activeView];

  if (!authSession) {
    return (
      <LoginScreen
        confirmPasswordReset={confirmPasswordReset}
        error={loginError}
        isLoading={isLoggingIn || isResettingPassword}
        login={login}
        requestPasswordReset={requestPasswordReset}
        resetMessage={resetMessage}
        resetToken={resetToken}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Command size={22} />
          </div>
          <div>
            <strong>AI Ops Hub</strong>
            <span>Enterprise Control Plane</span>
          </div>
        </div>

        <button
          className={activeView === "Settings" ? "header-settings-button active" : "header-settings-button"}
          onClick={() => setActiveView("Settings")}
          type="button"
        >
          <Settings2 size={17} />
          Settings
        </button>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map(([label, Icon]) => (
            <button
              className={activeView === label ? "active" : ""}
              key={label}
              onClick={() => setActiveView(label)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        <div className="tenant-card">
          <div className="tenant-icon">
            <KeyRound size={18} />
          </div>
          <div>
            <span>{activeTenant?.plan ?? "Enterprise"} tenant</span>
            <strong>{activeTenant?.name ?? "Northstar Health"}</strong>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="page-copy">
            <p className="eyebrow">{page.eyebrow}</p>
            <h1>{page.title}</h1>
            <p className="page-summary">{page.summary}</p>
          </div>
          <div className="topbar-actions">
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search runs, agents, events"
                placeholder="Search runs, agents, events"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="icon-button" aria-label="Notifications" onClick={() => setNotice("2 approvals require review. Checkout latency remains critical.")}>
              <Bell size={18} />
            </button>
            <button className="secondary-button" onClick={logout}>
              <KeyRound size={17} />
              Sign out
            </button>
            <button
              className="primary-button"
              onClick={() => {
                if (!canDeploy) {
                  setNotice(blockedReason("deploy agents"));
                  return;
                }
                setDeployOpen(true);
              }}
            >
              <Play size={17} />
              {canDeploy ? "Deploy Agent" : "Deploy locked"}
            </button>
          </div>
        </header>

        <div className="context-row">
          <div className="notice-bar" role="status">{notice}</div>
          <label className="tenant-chip">
            <KeyRound size={15} />
            <select
              aria-label="Active tenant"
              value={activeTenantId}
              onChange={(event) => {
                setActiveTenantId(event.target.value);
                setNotice(`Tenant switched to ${tenants.find((tenant) => tenant.id === event.target.value)?.name ?? event.target.value}.`);
              }}
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <OperationalStrip selectedProvider={selectedProvider} currentRole={currentRole} activeTenant={activeTenant} />

        {activeView === "Command Center" && (
          <div className="page-enter">
            <section className="hero-grid">
              <div className="hero-panel">
                <div className="status-row">
                  <span className="live-dot" />
                  Live event stream active
                </div>
                <h2>Kafka events are being routed through policy-aware LangGraph agents.</h2>
                <p>
                  Each run retrieves tenant knowledge, evaluates confidence, estimates cost, and stops at
                  approval gates before high-impact actions are executed.
                </p>
                <div className="agent-orbit" aria-hidden="true">
                  <div className="orbit-ring ring-one" />
                  <div className="orbit-ring ring-two" />
                  <div className="orbit-core">
                    <BrainCircuit size={28} />
                  </div>
                  <span className="orbit-node node-a">RAG</span>
                  <span className="orbit-node node-b">Kafka</span>
                  <span className="orbit-node node-c">LLM</span>
                  <span className="orbit-node node-d">RBAC</span>
                </div>
                <div className="flow-row">
                  {flow.map(({ label, icon: Icon }) => (
                    <div className="flow-step" key={label}>
                      <Icon size={18} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="hero-actions">
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (!canDeploy) {
                        setNotice(blockedReason("deploy agents"));
                        return;
                      }
                      setDeployOpen(true);
                    }}
                  >
                    <Sparkles size={17} />
                    Launch dry-run
                  </button>
                  <button className="secondary-button" onClick={() => setActiveView("Streaming")}>
                    <RadioTower size={17} />
                    Inspect stream
                  </button>
                </div>
              </div>

              <div className="insight-panel">
                <div className="panel-heading">
                  <span>Current RCA</span>
                  <strong>91% confidence</strong>
                </div>
                <p>
                  Checkout latency matches a historical database pool saturation pattern. Recommended
                  mitigation is staged worker restart plus pool-size inspection.
                </p>
                <div className="confidence-bar">
                  <span style={{ width: "91%" }} />
                </div>
                <button className="secondary-button" onClick={() => setTraceOpen(true)}>
                  View trace
                  <ChevronRight size={16} />
                </button>
              </div>
            </section>

            <MetricGrid />
            <DashboardPanels
              filteredAgents={filteredAgents}
              filteredEvents={filteredBackendEvents}
              streamStatus={streamStatus}
              streamError={streamError}
              reconnectStream={() => {
                streamUrlIndexRef.current += 1;
                setStreamReconnectKey((current) => current + 1);
              }}
              documents={indexedDocuments}
              isDocumentsLoading={isDocumentsLoading}
              documentsError={documentsError}
              documentActionId={documentActionId}
              refreshDocuments={loadIndexedDocuments}
              reindexDocument={reindexDocument}
              deleteDocument={deleteDocument}
              approvals={approvals}
              isApprovalsLoading={isApprovalsLoading}
              approvalError={approvalError}
              approvalActionId={approvalActionId}
              decideApproval={decideApproval}
              canDecideApproval={canDecideApproval}
              reviewAction={(title) => setNotice(`Review packet opened for: ${title}`)}
              openTrace={() => setTraceOpen(true)}
              openTools={() => setActiveView("Agent Builder")}
              canManageDocs={canManageDocs}
            />
          </div>
        )}

        {activeView === "Executive Demo" && (
          <ExecutiveDemoPanel
            executiveStep={executiveStep}
            isRunning={isExecutiveRunning}
            selectedProvider={selectedProvider}
            currentRole={currentRole}
            runDemo={() => setExecutiveRunning(true)}
            openKnowledge={() => setActiveView("Knowledge Base")}
            openAgent={() => setActiveView("Agent Builder")}
            openApprovals={() => setActiveView("Approvals")}
            openTrace={() => setTraceOpen(true)}
          />
        )}

        {activeView === "Agent Builder" && (
          <section className="content-grid single-view agent-builder-view page-enter">
            <div className="side-column">
              <AgentPanel agentsToShow={filteredAgents} openTools={() => setNotice("Tool registry opened: 12 tenant-scoped MCP tools available.")} />
              <AgentScorecardPanel />
            </div>
            <div className="side-column">
              <AgentRunPlayground
                events={backendEvents}
                selectedEventId={selectedEventId}
                setSelectedEventId={setSelectedEventId}
                result={agentRun}
                trace={agentTrace}
                isTraceLoading={isTraceLoading}
                traceError={traceError}
                isLoadingEvents={isEventsLoading}
                isRunning={isAgentRunning}
                error={agentRunError}
                refreshEvents={loadBackendEvents}
                runSelectedAgent={runSelectedAgent}
                refreshRunTrace={refreshRunTrace}
                openTrace={() => setTraceOpen(true)}
                canRun={canRunAgents}
                blockedReason={blockedReason("run agents")}
              />
              <AgentGovernancePanel />
            </div>
          </section>
        )}

        {activeView === "Knowledge Base" && (
          <section className="content-grid knowledge-view page-enter">
            <div className="knowledge-column">
              <KnowledgeAskPanel
                question={knowledgeQuestion}
                setQuestion={setKnowledgeQuestion}
                answer={knowledgeAnswer}
                isLoading={isKnowledgeLoading}
                error={knowledgeError}
                askKnowledgeBase={askKnowledgeBase}
              />
              <div className="panel upload-panel">
                <DocumentUploadBox
                  title={uploadTitle}
                  setTitle={setUploadTitle}
                  file={uploadFile}
                  result={uploadResult}
                  error={uploadError}
                  isUploading={isUploadingDocument}
                  canManage={canManageDocs}
                  blockedReason={blockedReason("upload documents")}
                  onFileChange={handleUploadFileChange}
                  uploadDocument={uploadDocument}
                />
              </div>
              <KnowledgeGovernancePanel />
            </div>
            <div className="knowledge-column">
              <RagPanel
                documents={indexedDocuments}
                isLoading={isDocumentsLoading}
                error={documentsError}
                actionId={documentActionId}
                refreshDocuments={loadIndexedDocuments}
                reindexDocument={reindexDocument}
                deleteDocument={deleteDocument}
                canManage={canManageDocs}
                blockedReason={blockedReason("manage documents")}
              />
              <div className="panel">
                <div className="section-title">
                  <div>
                    <p className="eyebrow">Evaluation</p>
                    <h3>Retrieval quality</h3>
                  </div>
                  <Database size={20} />
                </div>
                <div className="quality-grid">
                  <span>Faithfulness <strong>96%</strong></span>
                  <span>Citation coverage <strong>100%</strong></span>
                  <span>Rerank lift <strong>+18%</strong></span>
                </div>
              </div>
              <KnowledgeOpsPanel />
            </div>
          </section>
        )}

        {activeView === "Approvals" && (
          <section className="content-grid single-view page-enter">
            <ApprovalPanel
              approvals={approvals}
              isLoading={isApprovalsLoading}
              error={approvalError}
              actionId={approvalActionId}
              decideApproval={decideApproval}
              canDecideApproval={canDecideApproval}
              reviewAction={(title) => setNotice(`Review packet opened for: ${title}`)}
            />
            <div className="side-column">
              <div className="panel">
                <div className="section-title">
                  <div>
                    <p className="eyebrow">Audit Trail</p>
                    <h3>Policy decisions</h3>
                  </div>
                  <ShieldCheck size={20} />
                </div>
                <div className="event-list">
                  {approvals.map((approval) => (
                    <article className="event-card" key={`audit-${approval.id}`}>
                      <strong>{approval.action}</strong>
                      <p>Status: {approval.status} • Risk: {approval.risk}</p>
                    </article>
                  ))}
                  {approvals.length === 0 && <p className="empty-state">No approval decisions yet.</p>}
                </div>
              </div>
              <ApprovalPolicyPanel />
            </div>
          </section>
        )}

        {activeView === "Streaming" && (
          <section className="content-grid single-view page-enter">
            <EventsPanel
              eventsToShow={filteredBackendEvents}
              streamStatus={streamStatus}
              streamError={streamError}
              reconnectStream={() => {
                streamUrlIndexRef.current += 1;
                setStreamReconnectKey((current) => current + 1);
              }}
            />
            <div className="side-column">
              <EventIngestionPanel
                draft={eventDraft}
                setDraft={setEventDraft}
                isCreating={isCreatingEvent}
                error={eventCreateError}
                canCreate={canCreateEvents}
                blockedReason={blockedReason("create stream events")}
                createStreamEvent={createStreamEvent}
              />
              <StreamTopicHealthPanel />
              <StreamThroughputPanel />
            </div>
          </section>
        )}

        {activeView === "Marketplace" && (
          <MarketplacePanel
            templates={agentTemplates}
            isLoading={isTemplatesLoading}
            error={marketplaceError}
            actionId={templateActionId}
            result={templateDeployResult}
            canDeploy={currentRole === "Admin"}
            deployTemplate={deployTemplate}
            refresh={loadMarketplace}
          />
        )}

        {activeView === "ROI" && (
          <RoiPanel summary={roiSummary} error={roiError} refresh={loadRoiSummary} />
        )}

        {activeView === "Security Center" && (
          <SecurityCenterPanel
            summary={securitySummary}
            error={securityError}
            canView={currentRole === "Admin" || currentRole === "SRE"}
            refresh={loadSecuritySummary}
          />
        )}

        {activeView === "Admin Console" && (
          <AdminConsolePanel
            tenants={tenants}
            activeTenantId={activeTenantId}
            setActiveTenantId={setActiveTenantId}
            summary={adminSummary}
            integrations={integrations}
            auditLogs={auditLogs}
            error={adminError}
            actionId={integrationActionId}
            result={integrationResult}
            canAdmin={currentRole === "Admin"}
            exportHref={apiUrl(tenantPath("/audit-logs/export"))}
            refreshAdmin={loadAdminConsole}
            testIntegration={testIntegration}
            onboardingDraft={onboardingDraft}
            setOnboardingDraft={setOnboardingDraft}
            onboardingResult={onboardingResult}
            onboardingError={onboardingError}
            isOnboardingSaving={isOnboardingSaving}
            runOnboarding={runOnboarding}
          />
        )}

        {activeView === "Settings" && (
          <section className="content-grid single-view page-enter">
            <div className="side-column">
              <ArchitecturePanel />
              <AgentGovernancePanel />
            </div>
            <div className="side-column">
              <CostPanel />
              <ProviderSettingsPanel
                config={providerConfig}
                selectedProvider={selectedProvider}
                setSelectedProvider={(provider) => {
                  if (!canChangeProvider) {
                    setProviderError(blockedReason("change providers"));
                    return;
                  }
                  setSelectedProvider(provider);
                  setNotice(`Provider routing changed to ${provider}.`);
                }}
                currentRole={currentRole}
                setCurrentRole={(role) => {
                  setCurrentRole(role);
                  setNotice(`RBAC role switched to ${role}.`);
                }}
                error={providerError}
                canChangeProvider={canChangeProvider}
              />
              <ApprovalPolicyPanel />
            </div>
          </section>
        )}
      </section>

      {isDeployOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Deploy Agent">
          <div className="modal">
            <button className="close-button" aria-label="Close deploy dialog" onClick={() => setDeployOpen(false)}>
              <X size={18} />
            </button>
            <p className="eyebrow">Deployment Plan</p>
            <h3>Deploy Support Escalation Agent</h3>
            <p>
              This dry-run validates model provider routing, tenant RBAC, RAG source policy, and approval gates before production release.
            </p>
            <div className="check-row"><Check size={16} /><span>Preview environment ready</span></div>
            <div className="check-row"><Check size={16} /><span>Rollback policy attached</span></div>
            <button
              className="primary-button"
              onClick={() => {
                setDeployOpen(false);
                setNotice("Deployment dry-run completed successfully for Support Escalation Agent.");
              }}
            >
              <Sparkles size={17} />
              Run dry deployment
            </button>
          </div>
        </div>
      )}

      {isTraceOpen && (
        <div className="drawer" role="dialog" aria-label="Agent trace">
          <button className="close-button" aria-label="Close trace" onClick={() => setTraceOpen(false)}>
            <X size={18} />
          </button>
          <p className="eyebrow">Agent Trace</p>
          <h3>{agentTrace ? `${agentTrace.event_id} / ${agentTrace.agent_id}` : "evt-1092 / Incident Triage Agent"}</h3>
          <div className="trace-summary">
            <span>{agentTrace ? `${Math.round(agentTrace.confidence * 100)}% confidence` : "91% confidence"}</span>
            <span>{agentTrace ? `${agentTrace.risk} risk` : "high risk"}</span>
            <span>{agentTrace?.approval_required ?? true ? "approval gate" : "auto-approved"}</span>
          </div>
          {(agentTrace?.steps ?? fallbackTraceSteps).map((step, index) => (
            <div className="trace-step" key={`${step.title}-${index}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
                <small>{step.evidence}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function AdminConsolePanel({
  tenants,
  activeTenantId,
  setActiveTenantId,
  summary,
  integrations,
  auditLogs,
  error,
  actionId,
  result,
  canAdmin,
  exportHref,
  refreshAdmin,
  testIntegration,
  onboardingDraft,
  setOnboardingDraft,
  onboardingResult,
  onboardingError,
  isOnboardingSaving,
  runOnboarding
}: {
  tenants: Tenant[];
  activeTenantId: string;
  setActiveTenantId: (tenantId: string) => void;
  summary: AdminSummary | null;
  integrations: IntegrationStatus[];
  auditLogs: AuditLog[];
  error: string;
  actionId: string | null;
  result: IntegrationActionResult | null;
  canAdmin: boolean;
  exportHref: string;
  refreshAdmin: () => void;
  testIntegration: (integration: IntegrationStatus) => void;
  onboardingDraft: {
    company_name: string;
    industry: string;
    admin_email: string;
    first_agent_template_id: string;
    first_data_source: string;
  };
  setOnboardingDraft: (draft: {
    company_name: string;
    industry: string;
    admin_email: string;
    first_agent_template_id: string;
    first_data_source: string;
  }) => void;
  onboardingResult: OnboardingResult | null;
  onboardingError: string;
  isOnboardingSaving: boolean;
  runOnboarding: () => void;
}) {
  const activeTenant = tenants.find((tenant) => tenant.id === activeTenantId);
  const cards = [
    ["Tenants", summary?.tenant_count ?? tenants.length, "isolated workspaces"],
    ["Events", summary?.events ?? 0, "stream records"],
    ["Documents", summary?.documents ?? 0, "RAG sources"],
    ["Pending approvals", summary?.approvals_pending ?? 0, "human gates"],
    ["Agent runs", summary?.runs ?? 0, "audited decisions"],
    ["Spend", `$${((summary?.token_spend_cents ?? 0) / 100).toFixed(2)}`, "LLM cost tracked"]
  ];

  const integrationIcon = (id: IntegrationStatus["id"]) => {
    if (id === "github") return <Github size={18} />;
    if (id === "pagerduty") return <RadioTower size={18} />;
    return <Send size={18} />;
  };

  return (
    <section className="admin-console page-enter">
      <div className="panel admin-hero-panel">
        <div>
          <p className="eyebrow">Multi-Tenant SaaS Layer</p>
          <h2>{activeTenant?.name ?? "Tenant"} control room</h2>
          <p>
            Tenant data is isolated across events, RAG documents, approvals, runs, traces, and audit logs.
            Switch companies here to prove this behaves like a real SaaS product.
          </p>
        </div>
        <label className="admin-tenant-switch">
          <span>Active tenant</span>
          <select value={activeTenantId} onChange={(event) => setActiveTenantId(event.target.value)}>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name} / {tenant.industry}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="knowledge-error admin-error">{error}</div>}

      <div className="admin-kpi-grid">
        {cards.map(([label, value, helper]) => (
          <article className="admin-kpi-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{helper}</small>
          </article>
        ))}
      </div>

      <div className="panel onboarding-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">First-Run Onboarding</p>
            <h3>Company setup wizard</h3>
          </div>
          <Workflow size={20} />
        </div>
        <div className="onboarding-grid">
          <label className="upload-field">
            <span>Company</span>
            <input value={onboardingDraft.company_name} onChange={(event) => setOnboardingDraft({ ...onboardingDraft, company_name: event.target.value })} />
          </label>
          <label className="upload-field">
            <span>Industry</span>
            <input value={onboardingDraft.industry} onChange={(event) => setOnboardingDraft({ ...onboardingDraft, industry: event.target.value })} />
          </label>
          <label className="upload-field">
            <span>Admin email</span>
            <input value={onboardingDraft.admin_email} onChange={(event) => setOnboardingDraft({ ...onboardingDraft, admin_email: event.target.value })} />
          </label>
          <label className="upload-field">
            <span>First agent template</span>
            <select value={onboardingDraft.first_agent_template_id} onChange={(event) => setOnboardingDraft({ ...onboardingDraft, first_agent_template_id: event.target.value })}>
              <option value="tpl_incident_triage">Incident Triage Agent</option>
              <option value="tpl_customer_support">Customer Support Agent</option>
              <option value="tpl_revenue_risk">Revenue Risk Agent</option>
              <option value="tpl_security_alert">Security Alert Agent</option>
              <option value="tpl_compliance_evidence">Compliance Evidence Agent</option>
            </select>
          </label>
          <label className="upload-field wide-field">
            <span>First data source</span>
            <input value={onboardingDraft.first_data_source} onChange={(event) => setOnboardingDraft({ ...onboardingDraft, first_data_source: event.target.value })} />
          </label>
          <button className="primary-button full-width-button" disabled={!canAdmin || isOnboardingSaving} onClick={runOnboarding}>
            <Sparkles size={17} />
            {isOnboardingSaving ? "Preparing..." : "Prepare onboarding"}
          </button>
        </div>
        {!canAdmin && <p className="permission-note">Only Admin can create onboarding plans.</p>}
        {onboardingError && <div className="knowledge-error">{onboardingError}</div>}
        {onboardingResult && (
          <div className="onboarding-result" role="status">
            <strong>{onboardingResult.tenant_name} is ready to onboard</strong>
            <div className="control-stack">
              {onboardingResult.checklist.map((item) => (
                <div key={item}>
                  <span>Setup step</span>
                  <strong>{item}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <section className="content-grid single-view">
        <div className="side-column">
          <div className="panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Tenant Registry</p>
                <h3>Customer workspaces</h3>
              </div>
              <UsersRound size={20} />
            </div>
            <div className="tenant-grid-list">
              {tenants.map((tenant) => (
                <button
                  className={tenant.id === activeTenantId ? "active tenant-row-button" : "tenant-row-button"}
                  key={tenant.id}
                  onClick={() => setActiveTenantId(tenant.id)}
                  type="button"
                >
                  <div>
                    <strong>{tenant.name}</strong>
                    <span>{tenant.industry} • {tenant.plan} • {tenant.region}</span>
                  </div>
                  <small>{tenant.user_count} users • ${(tenant.budget_cents / 100).toFixed(0)} cap</small>
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Integrations</p>
                <h3>Slack, GitHub, PagerDuty</h3>
              </div>
              <GitBranch size={20} />
            </div>
            <div className="integration-grid">
              {integrations.map((integration) => (
                <article className="integration-card" key={integration.id}>
                  <div className="integration-heading">
                    {integrationIcon(integration.id)}
                    <div>
                      <strong>{integration.name}</strong>
                      <span className={integration.configured ? "pill good" : "pill warn"}>{integration.mode}</span>
                    </div>
                  </div>
                  <p>{integration.description}</p>
                  <small>{integration.last_result}</small>
                  <button
                    className="secondary-button full-width-button"
                    disabled={actionId === integration.id || !canAdmin}
                    onClick={() => testIntegration(integration)}
                  >
                    <Sparkles size={16} />
                    {actionId === integration.id ? "Testing..." : "Send test"}
                  </button>
                </article>
              ))}
            </div>
            {!canAdmin && <p className="permission-note">Only Admin can test external integrations.</p>}
            {result && (
              <div className="integration-result" role="status">
                <strong>{result.integration_id} {result.mode}</strong>
                <span>{result.message}</span>
              </div>
            )}
          </div>
        </div>

        <div className="side-column">
          <div className="panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Audit Evidence</p>
                <h3>Exportable activity log</h3>
              </div>
              <div className="section-actions">
                <button className="icon-button mini-icon-button" aria-label="Refresh admin console" onClick={refreshAdmin}>
                  <RefreshCcw size={16} />
                </button>
                <a className="secondary-button compact-button" href={exportHref} download="audit-logs.csv">
                  <Download size={15} />
                  Export CSV
                </a>
              </div>
            </div>
            <div className="audit-log-list">
              {auditLogs.map((log) => (
                <article className="audit-log-card" key={log.id}>
                  <div>
                    <strong>{log.action}</strong>
                    <span className="pill good">{log.status}</span>
                  </div>
                  <p>{log.detail}</p>
                  <small>{log.actor} • {log.target} • {new Date(log.created_at).toLocaleString()}</small>
                </article>
              ))}
              {auditLogs.length === 0 && <p className="empty-state">No audit logs yet. Run an agent, approve an action, or test an integration.</p>}
            </div>
          </div>

          <div className="panel dense-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Ship-Ready Proof</p>
                <h3>What this adds</h3>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="control-stack">
              <div>
                <span>SaaS isolation</span>
                <strong>Tenant query scope on every backend workflow</strong>
              </div>
              <div>
                <span>Enterprise integrations</span>
                <strong>Dry-run safe, live-key ready</strong>
              </div>
              <div>
                <span>Compliance trail</span>
                <strong>CSV export for audits and demos</strong>
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}

function LoginScreen({
  confirmPasswordReset,
  error,
  isLoading,
  login,
  requestPasswordReset,
  resetMessage,
  resetToken
}: {
  confirmPasswordReset: (token: string, newPassword: string) => void;
  error: string;
  isLoading: boolean;
  login: (email: string, password: string) => void;
  requestPasswordReset: (email: string) => void;
  resetMessage: string;
  resetToken: string;
}) {
  const [email, setEmail] = useState("admin@aiopshub.local");
  const [password, setPassword] = useState("admin123");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("admin12345");
  const [showPassword, setShowPassword] = useState(false);
  const [isResetMode, setResetMode] = useState(false);
  const demoUsers = [
    {
      role: "Admin",
      email: "admin@aiopshub.local",
      password: "admin123",
      tenantAccess: "3 tenants",
      permissions: "Full platform control",
      accent: "Admin"
    },
    {
      role: "SRE",
      email: "sre@aiopshub.local",
      password: "sre123",
      tenantAccess: "Northstar Health",
      permissions: "Run agents, upload runbooks, approve infra actions",
      accent: "SRE"
    },
    {
      role: "Support Lead",
      email: "support@aiopshub.local",
      password: "support123",
      tenantAccess: "CloudCart Retail",
      permissions: "Review customer actions and escalation packets",
      accent: "Support"
    },
    {
      role: "Viewer",
      email: "viewer@aiopshub.local",
      password: "viewer123",
      tenantAccess: "Northstar Health",
      permissions: "Read-only observability and audit access",
      accent: "Viewer"
    }
  ];
  const selectedDemo = demoUsers.find((user) => user.email === email) ?? demoUsers[0];

  return (
    <main className="login-shell">
      <section className="login-stage" aria-label="AI Ops Hub authentication">
        <div className="login-visual">
          <div className="login-copy">
            <div className="brand login-brand">
              <div className="brand-mark">
                <Command size={22} />
              </div>
              <div>
                <strong>AI Ops Hub</strong>
                <span>Secure tenant control plane</span>
              </div>
            </div>
            <p className="eyebrow">Production Auth Layer</p>
            <h1>Secure AI operations for every tenant.</h1>
            <p className="page-summary">
              Sign in with persisted demo users, JWT sessions, backend RBAC, and tenant-aware API access.
            </p>
          </div>

          <div className="auth-graphic" aria-hidden="true">
            <div className="auth-ring auth-ring-one" />
            <div className="auth-ring auth-ring-two" />
            <div className="auth-core">
              <ShieldCheck size={30} />
              <span>RBAC</span>
            </div>
            <div className="auth-node node-a">JWT</div>
            <div className="auth-node node-b">Tenant</div>
            <div className="auth-node node-c">Audit</div>
          </div>

          <div className="login-proof-grid">
            <div>
              <LockKeyhole size={18} />
              <strong>JWT protected</strong>
              <span>Every API call is authorized</span>
            </div>
            <div>
              <UsersRound size={18} />
              <strong>Tenant scoped</strong>
              <span>Membership controls data access</span>
            </div>
            <div>
              <Activity size={18} />
              <strong>Audit ready</strong>
              <span>Approvals and exports persist</span>
            </div>
          </div>
        </div>

        <section className="login-card" aria-label="Sign in">
          <div className="login-card-header">
            <span className="status-pill">Live backend auth</span>
            <h2>{isResetMode ? "Reset access" : "Welcome back"}</h2>
            <p>{isResetMode ? "Request a short-lived reset token, then set a new password." : "Use a demo role or enter credentials to open the secured command center."}</p>
          </div>

          {!isResetMode ? (
            <form
              className="login-form"
              onSubmit={(event) => {
                event.preventDefault();
                login(email, password);
              }}
            >
              <label className="upload-field">
                <span>Email</span>
                <input
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="upload-field">
                <span>Password</span>
                <div className="password-control">
                  <input
                    autoComplete="current-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((value) => !value)}
                    type="button"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
              <button className="primary-button full-width-button" disabled={isLoading} type="submit">
                <KeyRound size={17} />
                {isLoading ? "Signing in..." : "Sign in securely"}
              </button>
              <button className="link-button" onClick={() => setResetMode(true)} type="button">
                Forgot password?
              </button>
            </form>
          ) : (
            <form
              className="login-form reset-form"
              onSubmit={(event) => {
                event.preventDefault();
                confirmPasswordReset(resetCode || resetToken, newPassword);
              }}
            >
              <label className="upload-field">
                <span>Account email</span>
                <input autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <button className="secondary-button full-width-button" disabled={isLoading} onClick={() => requestPasswordReset(email)} type="button">
                <RefreshCcw size={17} />
                Request reset token
              </button>
              {resetToken && (
                <div className="reset-token-box">
                  <span>Development reset token</span>
                  <code>{resetToken}</code>
                </div>
              )}
              <label className="upload-field">
                <span>Reset token</span>
                <input value={resetCode} onChange={(event) => setResetCode(event.target.value)} placeholder="Paste reset token" />
              </label>
              <label className="upload-field">
                <span>New password</span>
                <input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </label>
              <button className="primary-button full-width-button" disabled={isLoading} type="submit">
                <ShieldCheck size={17} />
                Update password
              </button>
              <button className="link-button" onClick={() => setResetMode(false)} type="button">
                Back to sign in
              </button>
            </form>
          )}

          {resetMessage && <div className="auth-message">{resetMessage}</div>}

          <div className="demo-login-grid" aria-label="Demo user shortcuts">
            {demoUsers.map((user) => (
              <button
                className={`demo-login-button ${selectedDemo.role === user.role ? "active" : ""}`}
                data-role={user.accent}
                disabled={isLoading}
                key={user.role}
                onClick={() => {
                  setEmail(user.email);
                  setPassword(user.password);
                  login(user.email, user.password);
                }}
                type="button"
              >
                <span>Continue as</span>
                <strong>{user.role}</strong>
              </button>
            ))}
          </div>

          <div className="role-preview">
            <div>
              <span>Role access preview</span>
              <strong>{selectedDemo.role}</strong>
            </div>
            <dl>
              <div>
                <dt>Tenant access</dt>
                <dd>{selectedDemo.tenantAccess}</dd>
              </div>
              <div>
                <dt>Allowed work</dt>
                <dd>{selectedDemo.permissions}</dd>
              </div>
            </dl>
          </div>

          {error && <div className="knowledge-error">{error}</div>}
        </section>
      </section>
    </main>
  );
}

function MarketplacePanel({
  templates,
  isLoading,
  error,
  actionId,
  result,
  canDeploy,
  deployTemplate,
  refresh
}: {
  templates: AgentTemplate[];
  isLoading: boolean;
  error: string;
  actionId: string | null;
  result: AgentTemplateDeployResult | null;
  canDeploy: boolean;
  deployTemplate: (template: AgentTemplate) => void;
  refresh: () => void;
}) {
  return (
    <section className="page-enter marketplace-page">
      <div className="panel marketplace-hero">
        <div>
          <p className="eyebrow">Productized Agent Catalog</p>
          <h2>Launch enterprise use cases without custom setup.</h2>
          <p>
            Each template packages tools, approval gates, model routing, expected cost, and audit posture so a startup can adopt the platform quickly.
          </p>
        </div>
        <button className="icon-button mini-icon-button" aria-label="Refresh marketplace" onClick={refresh}>
          <RefreshCcw size={16} />
        </button>
      </div>

      {error && <div className="knowledge-error">{error}</div>}
      {result && (
        <div className="integration-result" role="status">
          <strong>{result.status}</strong>
          <span>Deployment record saved for {result.agent_id}.</span>
        </div>
      )}

      <div className="template-grid">
        {isLoading && <p className="empty-state">Loading agent templates...</p>}
        {!isLoading && templates.map((template) => (
          <article className="template-card" key={template.id}>
            <div className="template-card-top">
              <span>{template.category}</span>
              <strong>{template.name}</strong>
              <small>{template.model_provider}</small>
            </div>
            <p>{template.description}</p>
            <div className="template-list">
              <span>Tools</span>
              <div>{template.tools.map((tool) => <small key={tool}>{tool}</small>)}</div>
            </div>
            <div className="template-list">
              <span>Guardrails</span>
              <div>{template.guardrails.map((guardrail) => <small key={guardrail}>{guardrail}</small>)}</div>
            </div>
            <div className="template-footer">
              <span>${(template.estimated_cost_cents / 100).toFixed(2)}/run est.</span>
              <button
                className="primary-button compact-button"
                disabled={!canDeploy || actionId === template.id}
                onClick={() => deployTemplate(template)}
              >
                <Sparkles size={15} />
                {actionId === template.id ? "Deploying..." : template.deploy_status === "deployed" ? "Deploy another" : "Deploy"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!canDeploy && <p className="permission-note">Only Admin can deploy marketplace templates. Other roles can inspect the catalog.</p>}
    </section>
  );
}

function RoiPanel({ summary, error, refresh }: { summary: RoiSummary | null; error: string; refresh: () => void }) {
  const cards = [
    ["Incidents avoided", summary?.incidents_avoided ?? 0, "critical/high events covered"],
    ["Hours saved", summary?.hours_saved ?? 0, "ops effort removed"],
    ["Approval time saved", `${summary?.approval_minutes_saved ?? 0}m`, "human loop acceleration"],
    ["Monthly value", `$${(summary?.estimated_monthly_value ?? 0).toLocaleString()}`, "estimated founder ROI"]
  ];

  return (
    <section className="page-enter roi-page">
      <div className="panel marketplace-hero">
        <div>
          <p className="eyebrow">Executive ROI Dashboard</p>
          <h2>Turn engineering work into business proof.</h2>
          <p>Use this page in demos to show why the platform is worth buying, not just why the architecture is impressive.</p>
        </div>
        <button className="icon-button mini-icon-button" aria-label="Refresh ROI" onClick={refresh}>
          <RefreshCcw size={16} />
        </button>
      </div>
      {error && <div className="knowledge-error">{error}</div>}
      <div className="admin-kpi-grid roi-kpi-grid">
        {cards.map(([label, value, helper]) => (
          <article className="admin-kpi-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{helper}</small>
          </article>
        ))}
      </div>
      <section className="content-grid single-view">
        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Top Workflows</p>
              <h3>Where value compounds</h3>
            </div>
            <CircleDollarSign size={20} />
          </div>
          <div className="control-stack">
            {(summary?.top_workflows ?? []).map((workflow) => (
              <div key={workflow}>
                <span>ROI lane</span>
                <strong>{workflow}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="panel dense-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">FinOps Proof</p>
              <h3>Agent run cost</h3>
            </div>
            <CircleDollarSign size={20} />
          </div>
          <div className="budget-ring">
            <span>${((summary?.agent_run_cost_cents ?? 0) / 100).toFixed(2)}</span>
            <small>total demo agent spend</small>
          </div>
        </div>
      </section>
    </section>
  );
}

function SecurityCenterPanel({
  summary,
  error,
  canView,
  refresh
}: {
  summary: SecuritySummary | null;
  error: string;
  canView: boolean;
  refresh: () => void;
}) {
  return (
    <section className="page-enter security-page">
      <div className="panel marketplace-hero">
        <div>
          <p className="eyebrow">Trust Surface</p>
          <h2>Security posture for tenant-scoped AI operations.</h2>
          <p>Review API key readiness, risky pending permissions, active sessions, and security-relevant audit events.</p>
        </div>
        <button className="icon-button mini-icon-button" aria-label="Refresh security center" onClick={refresh}>
          <RefreshCcw size={16} />
        </button>
      </div>
      {!canView && <div className="knowledge-error">Viewer and Support Lead can inspect the product, but Security Center is restricted to Admin and SRE.</div>}
      {error && <div className="knowledge-error">{error}</div>}
      <div className="admin-kpi-grid">
        <article className="admin-kpi-card"><span>Failed logins</span><strong>{summary?.failed_logins ?? 0}</strong><small>demo auth monitor</small></article>
        <article className="admin-kpi-card"><span>Active sessions</span><strong>{summary?.active_sessions ?? 0}</strong><small>JWT session count</small></article>
        <article className="admin-kpi-card"><span>Risky permissions</span><strong>{summary?.risky_permissions ?? 0}</strong><small>pending high-risk approvals</small></article>
        <article className="admin-kpi-card"><span>API keys</span><strong>{summary?.api_keys_configured ?? 0}</strong><small>configured providers/integrations</small></article>
      </div>
      <div className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Security Events</p>
            <h3>Audit stream</h3>
          </div>
          <ShieldCheck size={20} />
        </div>
        <div className="audit-log-list">
          {(summary?.events ?? []).map((event) => (
            <article className="audit-log-card" key={event.id}>
              <div>
                <strong>{event.action}</strong>
                <span className={event.severity === "high" ? "pill danger" : "pill good"}>{event.severity}</span>
              </div>
              <p>{event.detail}</p>
              <small>{event.actor} • {event.target} • {new Date(event.created_at).toLocaleString()}</small>
            </article>
          ))}
          {canView && (summary?.events ?? []).length === 0 && <p className="empty-state">No security events yet. Run onboarding, deploy templates, or approve actions.</p>}
        </div>
      </div>
    </section>
  );
}

function ExecutiveDemoPanel({
  executiveStep,
  isRunning,
  selectedProvider,
  currentRole,
  runDemo,
  openKnowledge,
  openAgent,
  openApprovals,
  openTrace
}: {
  executiveStep: number;
  isRunning: boolean;
  selectedProvider: ProviderName;
  currentRole: UserRole;
  runDemo: () => void;
  openKnowledge: () => void;
  openAgent: () => void;
  openApprovals: () => void;
  openTrace: () => void;
}) {
  const steps = [
    ["Kafka event", "Checkout P95 crosses 800ms and enters platform.latency."],
    ["Agent reasoning", "Incident agent classifies severity, owner, risk, and confidence."],
    ["RAG evidence", "Runbook, RCA, and escalation policy are retrieved with citations."],
    ["Approval gate", "High-risk restart stops for SRE or Admin approval."],
    ["Audit trail", "Decision, trace, cost, and sources are persisted for review."],
    ["Business impact", "MTTR drops, unsafe automation is blocked, and leadership sees proof."]
  ];

  return (
    <section className="executive-demo page-enter">
      <div className="panel executive-hero">
        <div>
          <p className="eyebrow">Interview-Ready Story</p>
          <h2>Signal to safe action in one governed AI loop.</h2>
          <p>
            This demo shows what the platform does in plain business language: detect a live incident,
            ask an agent for evidence, require the right human approval, and leave an audit trail.
          </p>
        </div>
        <div className="executive-status">
          <span>Provider</span>
          <strong>{selectedProvider}</strong>
          <span>Role</span>
          <strong>{currentRole}</strong>
        </div>
      </div>

      <div className="content-grid single-view">
        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Demo Timeline</p>
              <h3>Operational storyline</h3>
            </div>
            <Activity size={20} />
          </div>
          <div className="executive-timeline">
            {steps.map(([title, detail], index) => (
              <article className={index <= executiveStep ? "active" : ""} key={title}>
                <span>{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </article>
            ))}
          </div>
          <button className="primary-button full-width-button" onClick={runDemo} disabled={isRunning}>
            <Sparkles size={17} />
            {isRunning ? "Running demo..." : "Run executive demo"}
          </button>
        </div>

        <div className="side-column">
          <div className="panel dense-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Proof Points</p>
                <h3>Why companies care</h3>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="quality-grid compact-quality">
              <span>Unsafe action blocked <strong>100%</strong></span>
              <span>Evidence attached <strong>3 sources</strong></span>
              <span>Audit ready <strong>5 steps</strong></span>
            </div>
          </div>
          <div className="panel dense-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Jump To</p>
                <h3>Live product areas</h3>
              </div>
              <Workflow size={20} />
            </div>
            <div className="executive-actions">
              <button className="secondary-button" onClick={openKnowledge}><FileSearch size={16} /> RAG evidence</button>
              <button className="secondary-button" onClick={openAgent}><BrainCircuit size={16} /> Agent run</button>
              <button className="secondary-button" onClick={openApprovals}><ShieldCheck size={16} /> Approval gate</button>
              <button className="secondary-button" onClick={openTrace}><GitBranch size={16} /> Audit trace</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricGrid() {
  return (
    <section className="metric-grid">
      {metrics.map(({ label, value, trend, icon: Icon }) => (
        <article className="metric-card" key={label}>
          <Icon size={20} />
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{trend}</small>
        </article>
      ))}
    </section>
  );
}

function OperationalStrip({ selectedProvider, currentRole, activeTenant }: { selectedProvider: ProviderName; currentRole: UserRole; activeTenant?: Tenant }) {
  const items = [
    ["Tenant", activeTenant?.name ?? "Northstar Health", activeTenant?.industry ?? "Healthtech"],
    ["Provider", selectedProvider, "live routing control"],
    ["Data", "SQL persisted", "Runs and docs durable"],
    ["Role", currentRole, "RBAC enforced"]
  ];

  return (
    <section className="ops-strip" aria-label="Operational summary">
      {items.map(([label, value, helper], index) => (
        <article className="ops-item" key={label} style={{ animationDelay: `${index * 70}ms` }}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{helper}</small>
        </article>
      ))}
    </section>
  );
}

function DashboardPanels({
  filteredAgents,
  filteredEvents,
  streamStatus,
  streamError,
  reconnectStream,
  documents,
  isDocumentsLoading,
  documentsError,
  documentActionId,
  refreshDocuments,
  reindexDocument,
  deleteDocument,
  approvals,
  isApprovalsLoading,
  approvalError,
  approvalActionId,
  decideApproval,
  canDecideApproval,
  reviewAction,
  openTrace,
  openTools,
  canManageDocs
}: {
  filteredAgents: typeof agents;
  filteredEvents: BackendEvent[];
  streamStatus: "connecting" | "connected" | "synced" | "fallback" | "disconnected";
  streamError: string;
  reconnectStream: () => void;
  documents: IndexedDocument[];
  isDocumentsLoading: boolean;
  documentsError: string;
  documentActionId: string | null;
  refreshDocuments: () => void;
  reindexDocument: (document: IndexedDocument) => void;
  deleteDocument: (document: IndexedDocument) => void;
  approvals: BackendApproval[];
  isApprovalsLoading: boolean;
  approvalError: string;
  approvalActionId: string | null;
  decideApproval: (approval: BackendApproval, decision: "approve" | "reject") => void;
  canDecideApproval: (approval: BackendApproval) => boolean;
  reviewAction: (title: string) => void;
  openTrace: () => void;
  openTools: () => void;
  canManageDocs: boolean;
}) {
  return (
    <section className="content-grid dashboard-columns">
      <div className="dashboard-column">
        <AgentPanel agentsToShow={filteredAgents} openTools={openTools} />
        <EventsPanel
          eventsToShow={filteredEvents}
          streamStatus={streamStatus}
          streamError={streamError}
          reconnectStream={reconnectStream}
        />
        <ArchitecturePanel />
      </div>
      <div className="dashboard-column">
        <ApprovalPanel
          approvals={approvals}
          isLoading={isApprovalsLoading}
          error={approvalError}
          actionId={approvalActionId}
          decideApproval={decideApproval}
          canDecideApproval={canDecideApproval}
          reviewAction={reviewAction}
        />
        <RagPanel
          documents={documents}
          isLoading={isDocumentsLoading}
          error={documentsError}
          actionId={documentActionId}
          refreshDocuments={refreshDocuments}
          reindexDocument={reindexDocument}
          deleteDocument={deleteDocument}
          canManage={canManageDocs}
          blockedReason="Current role cannot manage documents from the command center."
        />
        <CostPanel />
        <AgentGovernancePanel />
      </div>
      <button className="hidden-action" onClick={openTrace}>Open trace</button>
    </section>
  );
}

function AgentPanel({ agentsToShow, openTools }: { agentsToShow: typeof agents; openTools: () => void }) {
  return (
    <div className="panel large">
      <div className="section-title">
        <div>
          <p className="eyebrow">Agent Builder</p>
          <h3>Deployed enterprise agents</h3>
        </div>
        <button className="ghost-button" onClick={openTools}>
          <GitBranch size={16} />
          Tool Registry
        </button>
      </div>
      <div className="agent-list">
        {agentsToShow.map((agent) => (
          <article className="agent-card" key={agent.id}>
            <div className="agent-main">
              <div className="agent-avatar">
                <BrainCircuit size={20} />
              </div>
              <div>
                <div className="agent-title">
                  <strong>{agent.name}</strong>
                  <span className={agent.status === "Deployed" ? "pill good" : "pill warn"}>
                    {agent.status}
                  </span>
                </div>
                <p>{agent.domain} • {agent.model}</p>
                <div className="tool-list">
                  {agent.tools.map((tool) => (
                    <span key={tool}>{tool}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="agent-stats">
              <span>{agent.successRate}% success</span>
              <span>{agent.latency}ms p95</span>
              <span>{agent.cost}</span>
            </div>
          </article>
        ))}
        {agentsToShow.length === 0 && <p className="empty-state">No agents match this search.</p>}
      </div>
    </div>
  );
}

function AgentRunPlayground({
  events,
  selectedEventId,
  setSelectedEventId,
  result,
  trace,
  isTraceLoading,
  traceError,
  isLoadingEvents,
  isRunning,
  error,
  refreshEvents,
  runSelectedAgent,
  refreshRunTrace,
  openTrace,
  canRun,
  blockedReason
}: {
  events: BackendEvent[];
  selectedEventId: string;
  setSelectedEventId: (eventId: string) => void;
  result: AgentRunResult | null;
  trace: AgentTrace | null;
  isTraceLoading: boolean;
  traceError: string;
  isLoadingEvents: boolean;
  isRunning: boolean;
  error: string;
  refreshEvents: () => void;
  runSelectedAgent: () => void;
  refreshRunTrace: (runId: string) => void;
  openTrace: () => void;
  canRun: boolean;
  blockedReason: string;
}) {
  const selectedEvent = events.find((event) => event.id === selectedEventId);

  return (
    <div className="panel agent-run-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Agent Run Playground</p>
          <h3>Run an agent on a live event</h3>
        </div>
        <Workflow size={20} />
      </div>

      <div className="run-control">
        <label htmlFor="agent-event-select">Select event</label>
        <div className="select-row">
          <select
            id="agent-event-select"
            value={selectedEventId}
            onChange={(event) => setSelectedEventId(event.target.value)}
            disabled={isLoadingEvents || isRunning}
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.severity.toUpperCase()} / {event.topic} / {event.id}
              </option>
            ))}
          </select>
          <button className="icon-button mini-icon-button" aria-label="Refresh events" onClick={refreshEvents} disabled={isLoadingEvents || isRunning}>
            <RefreshCcw size={16} />
          </button>
        </div>
      </div>

      {selectedEvent ? (
        <article className="selected-event-card">
          <span className={`severity ${severityClass[selectedEvent.severity as keyof typeof severityClass] ?? "medium"}`}>
            {selectedEvent.severity}
          </span>
          <strong>{selectedEvent.summary}</strong>
          <p>{selectedEvent.topic} routed to {selectedEvent.assigned_agent_id}</p>
          <small>{Math.round(selectedEvent.confidence * 100)}% event confidence</small>
        </article>
      ) : (
        <p className="empty-state">{isLoadingEvents ? "Loading stream events..." : "No stream events available."}</p>
      )}

      <button className="primary-button full-width-button" onClick={runSelectedAgent} disabled={isRunning || !selectedEventId || !canRun}>
        <Play size={17} />
        {isRunning ? "Running agent..." : canRun ? "Run Agent" : "Run locked"}
      </button>
      {!canRun && <p className="permission-note">{blockedReason}</p>}

      {error && <div className="knowledge-error">{error}</div>}

      {result && (
        <div className="run-result-card" role="status">
          <div className="run-result-header">
            <span>Run result</span>
            <strong>{result.id}</strong>
          </div>
          <div className="run-metrics">
            <span><strong>{result.latency_ms}ms</strong> latency</span>
            <span><strong>{Math.round(result.confidence * 100)}%</strong> confidence</span>
            <span><strong>${(result.token_cost_cents / 100).toFixed(3)}</strong> cost</span>
            <span><strong>{result.approval_required ? "Required" : "Not needed"}</strong> approval</span>
          </div>
          <div className="recommended-action">
            <span>Recommended action</span>
            <p>{result.recommended_action}</p>
          </div>
          <div className="run-sources">
            {result.sources.map((source) => (
              <article key={`${result.id}-${source.title}`}>
                <strong>{source.title}</strong>
                <span>{Math.round(source.relevance * 100)}% relevance • {source.chunk_count} chunks • {source.source_type}</span>
              </article>
            ))}
          </div>
          <div className="trace-card">
            <div className="trace-card-header">
              <div>
                <span>Explainability trace</span>
                <strong>{trace ? `${trace.steps.length} audited steps` : isTraceLoading ? "Building trace..." : "Trace pending"}</strong>
              </div>
              <div className="trace-actions">
                <button className="secondary-button compact-button" onClick={() => refreshRunTrace(result.id)} disabled={isTraceLoading}>
                  <RefreshCcw size={14} />
                  Refresh
                </button>
                <button className="primary-button compact-button" onClick={openTrace} disabled={!trace && isTraceLoading}>
                  <FileSearch size={14} />
                  View trace
                </button>
              </div>
            </div>
            {traceError && <div className="knowledge-error">{traceError}</div>}
            {trace && (
              <div className="trace-mini-timeline">
                {trace.steps.slice(0, 4).map((step, index) => (
                  <article key={`${trace.id}-${step.title}`}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.evidence}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentGovernancePanel() {
  return (
    <div className="panel dense-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Governance</p>
          <h3>Release controls</h3>
        </div>
        <ShieldCheck size={20} />
      </div>
      <div className="control-stack">
        <div>
          <span>Tool contracts</span>
          <strong>12 MCP tools scoped</strong>
        </div>
        <div>
          <span>Trace policy</span>
          <strong>Every run audited</strong>
        </div>
        <div>
          <span>Budget guardrail</span>
          <strong>$50 tenant cap</strong>
        </div>
        <div>
          <span>Rollback</span>
          <strong>Dry-run required</strong>
        </div>
      </div>
    </div>
  );
}

function AgentScorecardPanel() {
  return (
    <div className="panel dense-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Deployment Score</p>
          <h3>Production readiness</h3>
        </div>
        <Activity size={20} />
      </div>
      <div className="control-stack">
        <div>
          <span>Versioning</span>
          <strong>3 active releases</strong>
        </div>
        <div>
          <span>Fallback chain</span>
          <strong>Claude to GPT-4o</strong>
        </div>
        <div>
          <span>Tool timeout</span>
          <strong>2.5s enforced</strong>
        </div>
        <div>
          <span>Owner review</span>
          <strong>SRE + product</strong>
        </div>
      </div>
    </div>
  );
}

function ApprovalPanel({
  approvals,
  isLoading,
  error,
  actionId,
  decideApproval,
  canDecideApproval,
  reviewAction
}: {
  approvals: BackendApproval[];
  isLoading: boolean;
  error: string;
  actionId: string | null;
  decideApproval: (approval: BackendApproval, decision: "approve" | "reject") => void;
  canDecideApproval: (approval: BackendApproval) => boolean;
  reviewAction: (title: string) => void;
}) {
  return (
    <div className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Approval Center</p>
          <h3>Human loop</h3>
        </div>
        <ShieldCheck size={20} />
      </div>
      <div className="approval-list">
        {isLoading && <p className="empty-state">Loading approvals...</p>}
        {error && <div className="knowledge-error">{error}</div>}
        {!isLoading && !error && approvals.map((item) => {
          const isApproved = item.status === "approved";
          const isRejected = item.status === "rejected";
          const isPending = item.status === "pending";
          const canDecide = canDecideApproval(item);
          return (
            <article className="approval-card" key={item.id}>
              <div>
                <strong>{item.action}</strong>
                <span className={isApproved ? "pill good" : isRejected ? "pill danger" : "pill warn"}>
                  {item.status}
                </span>
              </div>
              <p>{item.reason}</p>
              <small>{item.risk} risk • persisted backend decision</small>
              <div className="approval-actions">
                <button className="secondary-button" onClick={() => reviewAction(item.action)}>Review packet</button>
                {isPending ? (
                  <>
                    <button className="approve-button" disabled={actionId === item.id || !canDecide} onClick={() => decideApproval(item, "approve")}>
                      <Check size={15} />
                      {actionId === item.id ? "Saving" : "Approve"}
                    </button>
                    <button className="danger-button compact-button" disabled={actionId === item.id || !canDecide} onClick={() => decideApproval(item, "reject")}>
                      <X size={14} />
                      Reject
                    </button>
                  </>
                ) : (
                  <div className={isApproved ? "decision-final approved" : "decision-final rejected"}>
                    {isApproved ? <Check size={16} /> : <X size={16} />}
                    <span>{isApproved ? "Approved and persisted" : "Rejected and persisted"}</span>
                  </div>
                )}
              </div>
              {isPending && !canDecide && <p className="permission-note">Current role can inspect this approval, but cannot decide it.</p>}
            </article>
          );
        })}
        {!isLoading && !error && approvals.length === 0 && <p className="empty-state">No approvals waiting for review.</p>}
      </div>
    </div>
  );
}

function ApprovalPolicyPanel() {
  return (
    <div className="panel dense-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Policy Guardrails</p>
          <h3>Decision requirements</h3>
        </div>
        <KeyRound size={20} />
      </div>
      <div className="control-stack">
        <div>
          <span>Infrastructure restart</span>
          <strong>SRE approval</strong>
        </div>
        <div>
          <span>Customer notice</span>
          <strong>Support lead review</strong>
        </div>
        <div>
          <span>Financial action</span>
          <strong>Finance owner gate</strong>
        </div>
      </div>
    </div>
  );
}

function EventsPanel({
  eventsToShow,
  streamStatus,
  streamError,
  reconnectStream
}: {
  eventsToShow: BackendEvent[];
  streamStatus: "connecting" | "connected" | "synced" | "fallback" | "disconnected";
  streamError: string;
  reconnectStream: () => void;
}) {
  return (
    <div className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Live Stream</p>
          <h3>Operational events</h3>
        </div>
        <div className="stream-tools">
          <span className={`stream-status ${streamStatus}`}>
            <span className="live-dot" />
            {streamStatus}
          </span>
          <button className="icon-button mini-icon-button" aria-label="Reconnect stream" onClick={reconnectStream}>
            <RefreshCcw size={16} />
          </button>
        </div>
      </div>
      {streamError && <div className="knowledge-error">{streamError}</div>}
      <div className="event-list">
        {eventsToShow.map((event) => (
          <article className="event-card" key={event.id}>
            <div className="event-meta">
              <span className={`severity ${severityClass[normalizeSeverity(event.severity)]}`}>
                {normalizeSeverity(event.severity)}
              </span>
              <small>{event.topic}</small>
            </div>
            <strong>{event.summary}</strong>
            <p>{event.topic} routed to {event.assigned_agent_id}</p>
            <div className="event-footer">
              <span>{Math.round(event.confidence * 100)}% confidence</span>
              <span>{event.id}</span>
            </div>
          </article>
        ))}
        {eventsToShow.length === 0 && <p className="empty-state">No backend events match this search.</p>}
      </div>
    </div>
  );
}

function StreamTopicHealthPanel() {
  const topics = [
    ["platform.latency", "4 partitions", "91% routed"],
    ["billing.failures", "2 partitions", "88% routed"],
    ["support.tickets", "3 partitions", "72% routed"],
    ["security.alerts", "2 partitions", "77% routed"]
  ];

  return (
    <div className="panel dense-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Topic Health</p>
          <h3>Kafka routing</h3>
        </div>
        <RadioTower size={20} />
      </div>
      <div className="control-stack topic-health-list">
        {topics.map(([topic, partitions, routed]) => (
          <div key={topic}>
            <span>{topic}</span>
            <strong>{partitions} • {routed}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function StreamThroughputPanel() {
  return (
    <div className="panel dense-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Throughput</p>
          <h3>Routing window</h3>
        </div>
        <Activity size={20} />
      </div>
      <div className="quality-grid compact-quality">
        <span>Events/min <strong>1.8k</strong></span>
        <span>Consumer lag <strong>42ms</strong></span>
        <span>Retry rate <strong>0.6%</strong></span>
      </div>
    </div>
  );
}

function EventIngestionPanel({
  draft,
  setDraft,
  isCreating,
  error,
  canCreate,
  blockedReason,
  createStreamEvent
}: {
  draft: {
    topic: string;
    severity: string;
    summary: string;
    assigned_agent_id: string;
    confidence: number;
  };
  setDraft: (draft: {
    topic: string;
    severity: string;
    summary: string;
    assigned_agent_id: string;
    confidence: number;
  }) => void;
  isCreating: boolean;
  error: string;
  canCreate: boolean;
  blockedReason: string;
  createStreamEvent: () => void;
}) {
  return (
    <div className="panel event-ingestion-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Event Ingestion</p>
          <h3>Create stream event</h3>
        </div>
        <RadioTower size={20} />
      </div>

      <div className="ingestion-grid">
        <label className="upload-field">
          <span>Topic</span>
          <select
            value={draft.topic}
            onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
          >
            <option value="platform.latency">platform.latency</option>
            <option value="billing.failures">billing.failures</option>
            <option value="support.tickets">support.tickets</option>
            <option value="security.alerts">security.alerts</option>
          </select>
        </label>

        <label className="upload-field">
          <span>Severity</span>
          <select
            value={draft.severity}
            onChange={(event) => setDraft({ ...draft, severity: event.target.value })}
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>

        <label className="upload-field">
          <span>Assigned agent</span>
          <select
            value={draft.assigned_agent_id}
            onChange={(event) => setDraft({ ...draft, assigned_agent_id: event.target.value })}
          >
            <option value="agent_incident">Incident Triage Agent</option>
            <option value="agent_revenue">Revenue Risk Agent</option>
          </select>
        </label>

        <label className="upload-field">
          <span>Confidence: {Math.round(draft.confidence * 100)}%</span>
          <input
            min="0"
            max="1"
            step="0.01"
            type="range"
            value={draft.confidence}
            onChange={(event) => setDraft({ ...draft, confidence: Number(event.target.value) })}
          />
        </label>
      </div>

      <label className="upload-field">
        <span>Event summary</span>
        <textarea
          value={draft.summary}
          onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
          placeholder="Describe what happened in the business or platform stream."
          rows={4}
        />
      </label>

      <button className="primary-button full-width-button" onClick={createStreamEvent} disabled={isCreating || !canCreate}>
        <RadioTower size={17} />
        {isCreating ? "Creating event..." : canCreate ? "Create Event" : "Create locked"}
      </button>
      {!canCreate && <p className="permission-note">{blockedReason}</p>}

      {error && <div className="knowledge-error">{error}</div>}

      <div className="architecture-map compact-topic-map" aria-label="Supported topics">
        <span>platform.latency</span>
        <span>billing.failures</span>
        <span>support.tickets</span>
        <span>security.alerts</span>
      </div>
    </div>
  );
}

function KnowledgeAskPanel({
  question,
  setQuestion,
  answer,
  isLoading,
  error,
  askKnowledgeBase
}: {
  question: string;
  setQuestion: (question: string) => void;
  answer: KnowledgeAnswer | null;
  isLoading: boolean;
  error: string;
  askKnowledgeBase: (questionOverride?: string) => void;
}) {
  const exampleQuestion = "Why is checkout latency high?";
  const confidencePercent = answer ? Math.round(answer.confidence * 100) : 0;

  return (
    <div className="panel knowledge-ask-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Ask Knowledge Base</p>
          <h3>Question trusted company docs</h3>
        </div>
        <Sparkles size={20} />
      </div>

      <div className="ask-surface">
        <label htmlFor="knowledge-question">Ask about incidents, runbooks, policies, or RCA notes.</label>
        <textarea
          id="knowledge-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Example: Why is checkout latency high?"
          rows={3}
        />
        <div className="ask-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setQuestion(exampleQuestion);
              askKnowledgeBase(exampleQuestion);
            }}
            disabled={isLoading}
          >
            <RefreshCcw size={16} />
            Use example
          </button>
          <button className="primary-button" type="button" onClick={() => askKnowledgeBase()} disabled={isLoading}>
            <Sparkles size={16} />
            {isLoading ? "Asking..." : "Ask AI"}
          </button>
        </div>
      </div>

      {error && <div className="knowledge-error">{error}</div>}

      {answer ? (
        <div className="answer-card">
          <div className="answer-header">
            <span>{answer.provider} answer</span>
            <strong>{confidencePercent}% confidence</strong>
          </div>
          <p>{answer.answer}</p>
          <div className="confidence-bar compact">
            <span style={{ width: `${confidencePercent}%` }} />
          </div>
          <div className="source-citations">
            {answer.sources.map((source) => (
              <article key={source.chunk_id}>
                <div>
                  <strong>{source.title}</strong>
                  <span>{Math.round(source.score * 100)}% match • {source.source_type}</span>
                </div>
                <p>{source.text}</p>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className="answer-empty">
          <FileSearch size={20} />
          <span>Ask the sample checkout question to see citations and confidence from the RAG API.</span>
        </div>
      )}
    </div>
  );
}

function KnowledgeOpsPanel() {
  const ops = [
    { label: "Chunking", value: "semantic split" },
    { label: "Embeddings", value: "local fallback" },
    { label: "Rerank", value: "+18% lift" },
    { label: "Citations", value: "source locked" }
  ];

  return (
    <div className="panel dense-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">RAG Ops</p>
          <h3>Indexing pipeline</h3>
        </div>
        <FileSearch size={20} />
      </div>
      <div className="control-stack">
        {ops.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeGovernancePanel() {
  return (
    <div className="panel dense-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Source Control</p>
          <h3>Tenant-safe retrieval</h3>
        </div>
        <ShieldCheck size={20} />
      </div>
      <div className="control-stack">
        <div>
          <span>Tenant filter</span>
          <strong>Northstar only</strong>
        </div>
        <div>
          <span>PII handling</span>
          <strong>redaction ready</strong>
        </div>
        <div>
          <span>Freshness check</span>
          <strong>30 day review</strong>
        </div>
        <div>
          <span>Answer policy</span>
          <strong>cite or abstain</strong>
        </div>
      </div>
    </div>
  );
}

function DocumentUploadBox({
  title,
  setTitle,
  file,
  result,
  error,
  isUploading,
  canManage,
  blockedReason,
  onFileChange,
  uploadDocument
}: {
  title: string;
  setTitle: (title: string) => void;
  file: File | null;
  result: DocumentUploadResult | null;
  error: string;
  isUploading: boolean;
  canManage: boolean;
  blockedReason: string;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  uploadDocument: () => void;
}) {
  return (
    <div className="upload-box">
      <div className="upload-box-heading">
        <UploadCloud size={18} />
        <div>
          <strong>Upload document</strong>
          <span>Index text or markdown into the RAG pipeline.</span>
        </div>
      </div>

      <label className="upload-field">
        <span>Document title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Example: Checkout latency runbook"
        />
      </label>

      <label className="file-drop">
        <input accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" type="file" onChange={onFileChange} />
        <UploadCloud size={22} />
        <strong>{file ? file.name : "Choose .txt, .md, or .pdf file"}</strong>
        <span>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB ready to upload` : "The backend will chunk, embed, and store it."}</span>
      </label>

      <button className="secondary-button full-width-button" onClick={uploadDocument} disabled={isUploading || !canManage}>
        <UploadCloud size={17} />
        {isUploading ? "Indexing..." : canManage ? "Upload and index" : "Upload locked"}
      </button>
      {!canManage && <p className="permission-note">{blockedReason}</p>}

      {error && <div className="knowledge-error">{error}</div>}

      {result && (
        <div className="upload-result" role="status">
          <Check size={18} />
          <div>
            <strong>{result.title}</strong>
            <span>{result.chunk_count} chunk{result.chunk_count === 1 ? "" : "s"} indexed • {result.source_type}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RagPanel({
  documents,
  isLoading,
  error,
  actionId,
  refreshDocuments,
  reindexDocument,
  deleteDocument,
  canManage,
  blockedReason
}: {
  documents: IndexedDocument[];
  isLoading: boolean;
  error: string;
  actionId: string | null;
  refreshDocuments: () => void;
  reindexDocument: (document: IndexedDocument) => void;
  deleteDocument: (document: IndexedDocument) => void;
  canManage: boolean;
  blockedReason: string;
}) {
  return (
    <div className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">RAG Pipeline</p>
          <h3>Indexed documents</h3>
        </div>
        <button className="icon-button mini-icon-button" aria-label="Refresh documents" onClick={refreshDocuments}>
          <RefreshCcw size={16} />
        </button>
      </div>
      <div className="rag-list">
        {isLoading && <p className="empty-state">Loading indexed documents...</p>}
        {error && <div className="knowledge-error">{error}</div>}
        {!isLoading && !error && documents.map((document) => {
          const score = Math.min(0.98, Math.max(0.58, 0.72 + document.chunk_count * 0.035));

          return (
          <article className="rag-card document-card" key={document.id}>
            <div className="document-card-top">
              <div>
                <strong>{document.title}</strong>
                <span>{document.source_type}</span>
              </div>
              <div className="document-actions">
                <button
                  className="ghost-button compact-button"
                  onClick={() => reindexDocument(document)}
                  disabled={actionId === document.id || !canManage}
                >
                  <RefreshCcw size={14} />
                  {actionId === document.id ? "Working" : "Re-index"}
                </button>
                <button
                  className="danger-button compact-button"
                  onClick={() => deleteDocument(document)}
                  disabled={actionId === document.id || !canManage}
                >
                  <X size={14} />
                  Delete
                </button>
              </div>
            </div>
            {!canManage && <p className="permission-note">{blockedReason}</p>}
            <div className="source-score">
              <span style={{ width: `${score * 100}%` }} />
            </div>
            <small>{document.chunk_count} searchable chunk{document.chunk_count === 1 ? "" : "s"} • tenant indexed</small>
          </article>
          );
        })}
        {!isLoading && !error && documents.length === 0 && (
          <p className="empty-state">No indexed documents yet. Upload a runbook to make it searchable.</p>
        )}
      </div>
    </div>
  );
}

function ArchitecturePanel() {
  return (
    <div className="panel large architecture-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">System Design</p>
          <h3>Production architecture coverage</h3>
        </div>
        <Layers3 size={20} />
      </div>
      <div className="capability-grid">
        {capabilities.map(({ label, icon: Icon }) => (
          <div className="capability" key={label}>
            <Icon size={18} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="architecture-map">
        <span>Next.js UI</span>
        <span>FastAPI Gateway</span>
        <span>LangGraph Runtime</span>
        <span>Kafka Topics</span>
        <span>pgvector RAG</span>
        <span>Redis Cache</span>
        <span>Kubernetes</span>
        <span>Terraform AWS</span>
      </div>
    </div>
  );
}

function CostPanel() {
  return (
    <div className="panel cost-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">FinOps</p>
          <h3>Model cost policy</h3>
        </div>
        <CircleDollarSign size={20} />
      </div>
      <div className="budget-ring">
        <span>$42</span>
        <small>of $50 monthly demo budget</small>
      </div>
      <div className="provider-row">
        <span><Cpu size={15} /> Local fallback</span>
        <span>OpenAI ready</span>
        <span>Anthropic ready</span>
      </div>
      <p>
        Provider abstraction supports OpenAI, Anthropic, and Gemini-style routing with tenant
        budgets, fallback policy, and per-run token accounting.
      </p>
    </div>
  );
}

function ProviderSettingsPanel({
  config,
  selectedProvider,
  setSelectedProvider,
  currentRole,
  setCurrentRole,
  error,
  canChangeProvider
}: {
  config: ProviderConfig | null;
  selectedProvider: ProviderName;
  setSelectedProvider: (provider: ProviderName) => void;
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  error: string;
  canChangeProvider: boolean;
}) {
  const roles: UserRole[] = ["Admin", "SRE", "Support Lead", "Viewer"];
  const providers = config?.providers ?? [
    { id: "local" as ProviderName, label: "Local simulator", model: "local-enterprise-simulator", available: true, mode: "offline" },
    { id: "groq" as ProviderName, label: "Groq", model: "llama-3.3-70b-versatile", available: false, mode: "fallback" },
    { id: "openai" as ProviderName, label: "OpenAI", model: "gpt-4o-mini", available: false, mode: "fallback" },
    { id: "anthropic" as ProviderName, label: "Anthropic", model: "claude-3-5-sonnet-latest", available: false, mode: "fallback" }
  ];

  return (
    <div className="panel provider-settings-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Provider + RBAC</p>
          <h3>Runtime controls</h3>
        </div>
        <Settings2 size={20} />
      </div>

      <div className="setting-group">
        <span>LLM provider routing</span>
        <div className="segmented-control" role="group" aria-label="LLM provider">
          {providers.map((provider) => (
            <button
              className={selectedProvider === provider.id ? "active" : ""}
              disabled={!canChangeProvider}
              key={provider.id}
              onClick={() => setSelectedProvider(provider.id)}
              type="button"
            >
              <strong>{provider.label}</strong>
              <small>{provider.mode} • {provider.model}</small>
            </button>
          ))}
        </div>
        {!canChangeProvider && <p className="permission-note">Only Admin can change provider routing. Other roles can inspect the configuration.</p>}
      </div>

      <div className="setting-group">
        <span>Test user role</span>
        <div className="segmented-control compact-segments" role="group" aria-label="User role">
          {roles.map((role) => (
            <button
              className={currentRole === role ? "active" : ""}
              key={role}
              onClick={() => setCurrentRole(role)}
              type="button"
            >
              <strong>{role}</strong>
              <small>{role === "Viewer" ? "inspect only" : role === "Support Lead" ? "customer approvals" : role === "SRE" ? "infra approvals" : "full access"}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="provider-health-grid">
        {providers.map((provider) => (
          <article key={provider.id}>
            <span className={provider.available ? "live-dot" : "status-dot-warn"} />
            <div>
              <strong>{provider.label}</strong>
              <small>{provider.id === "local" ? "always available" : provider.available ? "API key configured" : "falls back locally"}</small>
            </div>
          </article>
        ))}
      </div>

      {error && <div className="knowledge-error">{error}</div>}
    </div>
  );
}
