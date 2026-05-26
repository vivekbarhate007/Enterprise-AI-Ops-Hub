import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  FileSearch,
  Gauge,
  GitBranch,
  LockKeyhole,
  RadioTower,
  ShieldCheck,
  Zap
} from "lucide-react";

export type Agent = {
  id: string;
  name: string;
  domain: string;
  model: string;
  status: "Deployed" | "Approval" | "Training";
  successRate: number;
  latency: number;
  cost: string;
  tools: string[];
};

export type Event = {
  id: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  source: string;
  summary: string;
  agent: string;
  confidence: number;
  time: string;
};

export type Metric = {
  label: string;
  value: string;
  trend: string;
  icon: LucideIcon;
};

export const metrics: Metric[] = [
  { label: "Agent Requests", value: "1.28M", trend: "+18.4% this week", icon: RadioTower },
  { label: "P95 Latency", value: "164ms", trend: "36ms under SLO", icon: Gauge },
  { label: "LLM Spend", value: "$42.18", trend: "tenant budget healthy", icon: Zap },
  { label: "Approval SLA", value: "91.7%", trend: "human loop on track", icon: ShieldCheck }
];

export const agents: Agent[] = [
  {
    id: "agent-incident",
    name: "Incident Triage Agent",
    domain: "SRE / Platform",
    model: "Claude 3.5 + GPT-4o fallback",
    status: "Deployed",
    successRate: 97,
    latency: 142,
    cost: "$0.018/run",
    tools: ["Runbook RAG", "SQL Diagnostics", "PagerDuty MCP", "Slack Draft"]
  },
  {
    id: "agent-revenue",
    name: "Revenue Risk Agent",
    domain: "Finance Ops",
    model: "GPT-4o mini",
    status: "Deployed",
    successRate: 94,
    latency: 188,
    cost: "$0.011/run",
    tools: ["Stripe Events", "CRM Query", "Anomaly Detector", "Approval Gate"]
  },
  {
    id: "agent-support",
    name: "Support Escalation Agent",
    domain: "Customer Support",
    model: "Claude 3.5 Sonnet",
    status: "Approval",
    successRate: 92,
    latency: 203,
    cost: "$0.024/run",
    tools: ["Zendesk Queue", "Policy RAG", "Tone Guardrail", "Email Draft"]
  }
];

export const events: Event[] = [
  {
    id: "evt-1092",
    severity: "Critical",
    source: "Kafka: platform.latency",
    summary: "Checkout API P95 crossed 800ms for enterprise tenant Northstar Health.",
    agent: "Incident Triage Agent",
    confidence: 91,
    time: "12s ago"
  },
  {
    id: "evt-1091",
    severity: "High",
    source: "Kafka: billing.failures",
    summary: "Payment retry failures up 23% after gateway deploy.",
    agent: "Revenue Risk Agent",
    confidence: 88,
    time: "46s ago"
  },
  {
    id: "evt-1089",
    severity: "Medium",
    source: "Kafka: support.tickets",
    summary: "VIP customer opened third unresolved ticket in 24 hours.",
    agent: "Support Escalation Agent",
    confidence: 84,
    time: "2m ago"
  }
];

export const ragSources = [
  { title: "Checkout Latency Runbook", type: "Markdown", score: 0.94, chunks: 18 },
  { title: "Postgres Pool Saturation RCA", type: "PDF", score: 0.91, chunks: 31 },
  { title: "Enterprise Escalation Policy", type: "Confluence", score: 0.89, chunks: 12 }
];

export const approvalQueue = [
  {
    title: "Restart checkout-worker deployment",
    risk: "High",
    reason: "Agent found pool exhaustion pattern with 91% confidence.",
    impact: "May recover checkout latency; requires SRE approval."
  },
  {
    title: "Send proactive customer notice",
    risk: "Medium",
    reason: "Three affected enterprise accounts meet escalation policy.",
    impact: "Draft created, waiting for support lead review."
  }
];

export const flow = [
  { label: "Kafka Event", icon: RadioTower },
  { label: "LangGraph Agent", icon: BrainCircuit },
  { label: "RAG + Rerank", icon: FileSearch },
  { label: "Approval Gate", icon: LockKeyhole },
  { label: "Audited Action", icon: CheckCircle2 }
];

export const capabilities = [
  { label: "Tenant-aware RBAC", icon: ShieldCheck },
  { label: "pgvector retrieval", icon: Database },
  { label: "LLMOps telemetry", icon: Activity },
  { label: "Tool contracts", icon: GitBranch },
  { label: "SLO tracking", icon: Clock3 },
  { label: "Risk guardrails", icon: AlertTriangle }
];
