export type ViewName =
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

export type ProviderName = "local" | "groq" | "openai" | "anthropic";
export type UserRole = "Admin" | "SRE" | "Support Lead" | "Viewer";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export type AuthSession = {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: AuthUser;
};

export type StreamEvent = {
  id: string;
  tenant_id: string;
  topic: string;
  severity: string;
  summary: string;
  assigned_agent_id: string;
  confidence: number;
};

export type DocumentUploadResult = {
  id: string;
  tenant_id: string;
  title: string;
  source_type: string;
  chunk_count: number;
};
