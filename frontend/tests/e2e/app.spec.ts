import { expect, test } from "@playwright/test";

const authSession = {
  access_token: "e2e-token",
  token_type: "bearer",
  expires_at: "2099-01-01T00:00:00Z",
  user: {
    id: "user_admin",
    email: "admin@aiopshub.local",
    name: "Vivek Admin",
    role: "Admin",
    memberships: [
      { tenant_id: "tenant_northstar_health", role: "Admin" },
      { tenant_id: "tenant_acme_fintech", role: "Admin" },
      { tenant_id: "tenant_cloudcart_retail", role: "Admin" }
    ]
  }
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((session) => {
    window.sessionStorage.setItem("enterprise-ai-ops-hub-auth", JSON.stringify(session));
  }, authSession);

  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(authSession) });
  });

  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(authSession.user) });
  });

  await page.route("**/api/v1/auth/logout", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route("**/api/v1/auth/password-reset/request", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        message: "If that email exists, a reset link has been prepared.",
        reset_token: "reset-token-e2e",
        expires_at: "2099-01-01T00:00:00Z"
      })
    });
  });

  await page.route("**/api/v1/auth/password-reset/confirm", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", message: "Password updated. Sign in with your new password." })
    });
  });

  await page.route("**/api/v1/tenants", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "tenant_northstar_health",
          name: "Northstar Health",
          industry: "Healthtech",
          plan: "Enterprise",
          region: "us-east-1",
          budget_cents: 5000,
          provider_mode: "groq-ready",
          user_count: 42,
          integration_count: 3
        },
        {
          id: "tenant_acme_fintech",
          name: "Acme Fintech",
          industry: "Fintech",
          plan: "Scale",
          region: "us-west-2",
          budget_cents: 8000,
          provider_mode: "local-safe",
          user_count: 31,
          integration_count: 2
        },
        {
          id: "tenant_cloudcart_retail",
          name: "CloudCart Retail",
          industry: "Retail",
          plan: "Growth",
          region: "eu-west-1",
          budget_cents: 6500,
          provider_mode: "groq-ready",
          user_count: 26,
          integration_count: 2
        }
      ])
    });
  });

  await page.route("**/api/v1/agent-templates**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          template_id: "tpl_security_alert",
          agent_id: "agent_security_alert_test",
          tenant_id: "tenant_northstar_health",
          status: "deployed",
          message: "Security Alert Agent deployed with 3 tools and 3 guardrails."
        })
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "tpl_security_alert",
          name: "Security Alert Agent",
          category: "Security",
          description: "Triages suspicious login velocity, API key exposure, and unusual tenant access changes.",
          model_provider: "groq:llama-3.3-70b-versatile",
          tools: ["Audit Log Search", "Session Review", "Slack Security Channel"],
          guardrails: ["Human review for account lock", "Evidence required", "No destructive action"],
          estimated_cost_cents: 2,
          required_role: "Admin",
          deploy_status: "available"
        }
      ])
    });
  });

  await page.route("**/api/v1/security/summary**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tenant_id: "tenant_northstar_health",
        failed_logins: 0,
        active_sessions: 1,
        risky_permissions: 1,
        api_keys_configured: 2,
        events: [
          {
            id: "audit_security_test",
            severity: "medium",
            actor: "admin@aiopshub.local",
            action: "integration.slack.test",
            target: "#ai-ops-incidents",
            status: "dry-run",
            detail: "Slack integration dry-run completed.",
            created_at: "2026-05-25T12:00:00Z"
          }
        ]
      })
    });
  });

  await page.route("**/api/v1/roi**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tenant_id: "tenant_northstar_health",
        incidents_avoided: 3,
        hours_saved: 14.5,
        approval_minutes_saved: 54,
        estimated_monthly_value: 4387,
        agent_run_cost_cents: 7,
        top_workflows: ["Incident triage and runbook retrieval", "Human approval evidence collection"]
      })
    });
  });

  await page.route("**/api/v1/onboarding**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tenant_name: "HelioPay",
        admin_email: "founder@heliopay.local",
        recommended_template_id: "tpl_incident_triage",
        checklist: ["Create tenant workspace for HelioPay", "Invite admin founder@heliopay.local"],
        status: "ready"
      })
    });
  });
});

test("login screen signs in with a backend-issued session", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("enterprise-ai-ops-hub-auth");
    window.sessionStorage.removeItem("enterprise-ai-ops-hub-auth");
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Secure AI operations for every tenant." })).toBeVisible();
  await expect(page.getByText("Role access preview")).toBeVisible();
  await expect(page.getByText("Full platform control")).toBeVisible();
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByRole("button", { name: "Hide password" })).toBeVisible();
  await page.getByRole("button", { name: "Continue as Admin" }).click();
  await expect(page.getByRole("heading", { name: "Autonomous agents with enterprise-grade control." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("password reset flow shows a single-use reset path", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("enterprise-ai-ops-hub-auth");
    window.sessionStorage.removeItem("enterprise-ai-ops-hub-auth");
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset access" })).toBeVisible();
  await page.getByRole("button", { name: "Request reset token" }).click();
  await expect(page.getByText("reset-token-e2e")).toBeVisible();
  await page.getByPlaceholder("Paste reset token").fill("reset-token-e2e");
  await page.getByLabel("New password").fill("admin12345");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Password updated. Sign in with your new password.")).toBeVisible();
});

test("command center core flow works", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Autonomous agents with enterprise-grade control." })).toBeVisible();
  await expect(page.locator(".metric-card")).toHaveCount(4);
  await expect(page.locator(".agent-card")).toHaveCount(3);

  await page.getByLabel("Search runs, agents, events").fill("Revenue");
  await expect(page.locator(".agent-card")).toHaveCount(1);
  await page.getByLabel("Search runs, agents, events").fill("");

  await page.getByRole("button", { name: "Deploy Agent" }).click();
  await expect(page.getByRole("dialog", { name: "Deploy Agent" })).toBeVisible();
  await page.getByRole("button", { name: "Run dry deployment" }).click();
  await expect(page.getByText("Deployment dry-run completed successfully for Support Escalation Agent.")).toBeVisible();

  await page.getByRole("button", { name: "View trace" }).click();
  await expect(page.getByRole("dialog", { name: "Agent trace" })).toBeVisible();
  await page.getByRole("button", { name: "Close trace" }).click();
  await expect(page.getByRole("dialog", { name: "Agent trace" })).toBeHidden();
});

test("all primary pages are reachable", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Agent Builder" }).click();
  await expect(page.getByRole("heading", { name: "Design, govern, and deploy AI workers." })).toBeVisible();

  await page.getByRole("button", { name: "Executive Demo" }).click();
  await expect(page.getByRole("heading", { name: "One incident, fully governed from signal to action." })).toBeVisible();

  await page.getByRole("button", { name: "Knowledge Base" }).click();
  await expect(page.getByRole("heading", { name: "Ground every answer in trusted tenant knowledge." })).toBeVisible();

  await page.getByRole("button", { name: "Approvals" }).click();
  await expect(page.getByRole("heading", { name: "Review high-impact actions before execution." })).toBeVisible();

  await page.getByRole("button", { name: "Streaming" }).click();
  await expect(page.getByRole("heading", { name: "Watch Kafka events flow into policy-aware agents." })).toBeVisible();

  await page.getByRole("button", { name: "Marketplace" }).click();
  await expect(page.getByRole("heading", { name: "Deploy governed AI workers from production templates." })).toBeVisible();

  await page.getByRole("button", { name: "ROI" }).click();
  await expect(page.getByRole("heading", { name: "Show the business value behind every autonomous workflow." })).toBeVisible();

  await page.getByRole("button", { name: "Security Center" }).click();
  await expect(page.getByRole("heading", { name: "Prove access control, API key posture, and audit readiness." })).toBeVisible();

  await page.getByRole("button", { name: "Admin Console" }).click();
  await expect(page.getByRole("heading", { name: "Manage tenants, integrations, and audit evidence." })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Budgets, providers, guardrails, and tenant policy." })).toBeVisible();
});

test("executive demo runs the full governed incident story", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Executive Demo" }).click();

  await expect(page.getByText("Signal to safe action in one governed AI loop.")).toBeVisible();
  await page.getByRole("button", { name: "Run executive demo" }).click();
  await expect(page.getByRole("button", { name: "Running demo..." })).toBeVisible();
  await expect(page.locator(".executive-timeline article").filter({ hasText: "Business impact" })).toHaveClass(/active/, { timeout: 5000 });
  await expect(page.getByText("Executive demo completed")).toBeVisible();

  await page.getByRole("button", { name: "RAG evidence" }).click();
  await expect(page.getByRole("heading", { name: "Ground every answer in trusted tenant knowledge." })).toBeVisible();
});

test("settings provider routing and RBAC controls gate actions", async ({ page }) => {
  await page.route("http://127.0.0.1:8000/api/v1/providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        selected_provider: "local",
        providers: [
          { id: "local", label: "Local simulator", model: "local-enterprise-simulator", available: true, mode: "offline" },
          { id: "groq", label: "Groq", model: "llama-3.3-70b-versatile", available: false, mode: "fallback" },
          { id: "openai", label: "OpenAI", model: "gpt-4o-mini", available: false, mode: "fallback" },
          { id: "anthropic", label: "Anthropic", model: "claude-3-5-sonnet-latest", available: false, mode: "fallback" }
        ]
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("button", { name: /Groq/ })).toBeVisible();
  await page.getByRole("button", { name: /Groq/ }).click();
  await expect(page.getByText("Provider routing changed to groq.")).toBeVisible();

  await page.getByRole("button", { name: /Viewer/ }).click();
  await expect(page.getByText("RBAC role switched to Viewer.")).toBeVisible();
  await page.getByRole("button", { name: "Deploy locked" }).click();
  await expect(page.getByText("Viewer role can inspect this area, but cannot deploy agents.")).toBeVisible();

  await page.getByRole("button", { name: "Knowledge Base" }).click();
  await expect(page.getByRole("button", { name: "Upload locked" })).toBeDisabled();
  await expect(page.getByText("Viewer role can inspect this area, but cannot upload documents.")).toBeVisible();
});

test("knowledge base question flow shows cited answer", async ({ page }) => {
  await page.route("http://127.0.0.1:8000/api/v1/rag/query**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        query: "Why is checkout latency high?",
        answer: "The strongest evidence points to checkout latency caused by database pool saturation.",
        provider: "local",
        confidence: 0.22,
        sources: [
          {
            document_id: "doc_checkout_runbook",
            chunk_id: "doc_checkout_runbook_chunk_0",
            title: "Checkout Latency Runbook",
            source_type: "markdown",
            score: 0.3354105,
            text: "When checkout latency rises, inspect database connection pools and slow queries."
          }
        ]
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Knowledge Base" }).click();
  await page.getByRole("button", { name: "Ask AI" }).click();

  await expect(page.getByText("database pool saturation")).toBeVisible();
  await expect(page.getByText("22% confidence")).toBeVisible();
  await expect(page.locator(".source-citations").getByText("Checkout Latency Runbook")).toBeVisible();
});

test("knowledge base document upload flow shows indexed result", async ({ page }) => {
  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/documents(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "doc_checkout_runbook",
          tenant_id: "tenant_demo",
          title: "Checkout Latency Runbook",
          source_type: "markdown",
          chunk_count: 1
        }
      ])
    });
  });

  await page.route("**/api/v1/documents/upload**", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "doc_demo_upload",
        tenant_id: "tenant_demo",
        title: "Demo Checkout Runbook",
        source_type: "txt",
        chunk_count: 1
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Knowledge Base" }).click();
  await page.getByPlaceholder("Example: Checkout latency runbook").fill("Demo Checkout Runbook");
  await page.locator(".file-drop input").setInputFiles({
    name: "demo-runbook.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Database pool saturation can cause checkout latency.")
  });
  await expect(page.getByText("demo-runbook.txt")).toBeVisible();

  await page.getByRole("button", { name: "Upload and index" }).click();

  await expect(page.locator(".upload-result").getByText("Demo Checkout Runbook")).toBeVisible();
  await expect(page.getByText("Indexed \"Demo Checkout Runbook\" into 1 searchable chunk.")).toBeVisible();
});

test("knowledge base indexed documents load from backend", async ({ page }) => {
  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/documents(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "doc_live_runbook",
          tenant_id: "tenant_demo",
          title: "Live Backend Runbook",
          source_type: "txt",
          chunk_count: 3
        },
        {
          id: "doc_escalation_policy",
          tenant_id: "tenant_demo",
          title: "Enterprise Escalation Policy",
          source_type: "policy",
          chunk_count: 1
        }
      ])
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Knowledge Base" }).click();

  await expect(page.getByRole("heading", { name: "Indexed documents" })).toBeVisible();
  await expect(page.getByText("Live Backend Runbook")).toBeVisible();
  await expect(page.getByText("3 searchable chunks")).toBeVisible();
  await expect(page.getByText("Enterprise Escalation Policy")).toBeVisible();
});

test("knowledge base document lifecycle controls work", async ({ page }) => {
  let documents = [
    {
      id: "doc_lifecycle",
      tenant_id: "tenant_demo",
      title: "Lifecycle Runbook",
      source_type: "txt",
      chunk_count: 2
    }
  ];

  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/documents(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(documents)
    });
  });

  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/documents\/doc_lifecycle\/reindex(?:\?.*)?$/, async (route) => {
    documents = [{ ...documents[0], chunk_count: 3 }];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(documents[0])
    });
  });

  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/documents\/doc_lifecycle(?:\?.*)?$/, async (route) => {
    documents = [];
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Knowledge Base" }).click();

  const card = page.locator(".rag-card").filter({ hasText: "Lifecycle Runbook" });
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Re-index" }).click();
  await expect(page.getByText("Re-indexed \"Lifecycle Runbook\" into 3 searchable chunks.")).toBeVisible();
  await expect(card.getByText("3 searchable chunks")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Lifecycle Runbook");
    await dialog.accept();
  });
  await card.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Deleted \"Lifecycle Runbook\" from the knowledge base.")).toBeVisible();
  await expect(page.getByText("No indexed documents yet. Upload a runbook to make it searchable.")).toBeVisible();
});

test("agent run playground executes an event run", async ({ page }) => {
  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/events(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "evt_demo_latency",
          tenant_id: "tenant_demo",
          topic: "platform.latency",
          severity: "critical",
          summary: "Checkout API P95 crossed 800ms for enterprise tenant.",
          assigned_agent_id: "agent_incident",
          confidence: 0.91
        }
      ])
    });
  });

  await page.route("**/api/v1/events/*/run**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "run_evt_demo_latency",
        tenant_id: "tenant_demo",
        agent_id: "agent_incident",
        event_id: "evt_demo_latency",
        latency_ms: 164,
        token_cost_cents: 2,
        confidence: 0.91,
        approval_required: true,
        recommended_action: "Inspect database connection pools and require SRE approval before restarting workers.",
        sources: [
          {
            title: "Checkout Latency Runbook",
            source_type: "markdown",
            relevance: 0.94,
            chunk_count: 18
          }
        ]
      })
    });
  });

  await page.route("**/api/v1/runs/run_evt_demo_latency/trace**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "trace_run_evt_demo_latency",
        tenant_id: "tenant_demo",
        run_id: "run_evt_demo_latency",
        event_id: "evt_demo_latency",
        agent_id: "agent_incident",
        risk: "high",
        confidence: 0.91,
        approval_required: true,
        steps: [
          {
            title: "Event received",
            detail: "platform.latency event was routed to agent_incident.",
            status: "completed",
            evidence: "Critical severity with 91% event confidence."
          },
          {
            title: "Knowledge retrieved",
            detail: "Trusted sources were attached to the recommendation.",
            status: "completed",
            evidence: "Checkout Latency Runbook (94% relevance)"
          },
          {
            title: "Risk evaluated",
            detail: "Risk was classified as high.",
            status: "completed",
            evidence: "Approval required: yes."
          }
        ]
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Agent Builder" }).click();
  await expect(page.getByRole("heading", { name: "Run an agent on a live event" })).toBeVisible();
  await expect(page.locator("#agent-event-select")).toHaveValue("evt_demo_latency");

  await page.getByRole("button", { name: "Run Agent" }).click();

  const result = page.locator(".run-result-card");
  await expect(result.getByText("run_evt_demo_latency")).toBeVisible();
  await expect(result.getByText("164ms")).toBeVisible();
  await expect(result.locator(".run-metrics").getByText("91%", { exact: true })).toBeVisible();
  await expect(result.getByText("Inspect database connection pools")).toBeVisible();
  await expect(result.locator(".run-sources").getByText("Checkout Latency Runbook", { exact: true })).toBeVisible();
  await expect(result.getByText("3 audited steps")).toBeVisible();
  await expect(result.getByText("Knowledge retrieved")).toBeVisible();

  await result.getByRole("button", { name: "View trace" }).click();
  const traceDrawer = page.getByRole("dialog", { name: "Agent trace" });
  await expect(traceDrawer).toBeVisible();
  await expect(traceDrawer.getByText("evt_demo_latency / agent_incident")).toBeVisible();
  await expect(traceDrawer.getByText("Checkout Latency Runbook (94% relevance)")).toBeVisible();
});

test("streaming page renders backend event feed", async ({ page }) => {
  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/events(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "evt_stream_test",
          tenant_id: "tenant_demo",
          topic: "security.alerts",
          severity: "medium",
          summary: "Suspicious login velocity detected for tenant admin.",
          assigned_agent_id: "agent_incident",
          confidence: 0.77
        }
      ])
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Streaming" }).click();

  await expect(page.getByRole("heading", { name: "Operational events" })).toBeVisible();
  await expect(page.getByText("Suspicious login velocity detected")).toBeVisible();
  await expect(page.getByText("security.alerts routed to agent_incident")).toBeVisible();
  await expect(page.getByText("77% confidence")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect stream" })).toBeVisible();
});

test("streaming page creates an event and makes it runnable", async ({ page }) => {
  const createdEvent = {
    id: "evt_created_checkout",
    tenant_id: "tenant_demo",
    topic: "platform.latency",
    severity: "critical",
    summary: "Checkout workers are queueing requests after a payment gateway deploy.",
    assigned_agent_id: "agent_incident",
    confidence: 0.88
  };

  let events: typeof createdEvent[] = [];

  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/events(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as typeof createdEvent;
      events = [{ ...createdEvent, ...body, id: createdEvent.id, tenant_id: "tenant_demo" }];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(events[0])
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(events)
    });
  });

  await page.route("**/api/v1/events/*/run**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "run_evt_created_checkout",
        tenant_id: "tenant_demo",
        agent_id: "agent_incident",
        event_id: "evt_created_checkout",
        latency_ms: 142,
        token_cost_cents: 2,
        confidence: 0.88,
        approval_required: true,
        recommended_action: "Review the payment deploy and inspect checkout-worker queue depth.",
        sources: [
          {
            title: "Checkout Latency Runbook",
            source_type: "markdown",
            relevance: 0.92,
            chunk_count: 18
          }
        ]
      })
    });
  });

  await page.route("**/api/v1/runs/run_evt_created_checkout/trace**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "trace_run_evt_created_checkout",
        tenant_id: "tenant_demo",
        run_id: "run_evt_created_checkout",
        event_id: "evt_created_checkout",
        agent_id: "agent_incident",
        risk: "high",
        confidence: 0.88,
        approval_required: true,
        steps: [
          {
            title: "Event received",
            detail: "Created event was routed to agent_incident.",
            status: "completed",
            evidence: "Critical severity with 88% event confidence."
          },
          {
            title: "Action recommended",
            detail: "Review the payment deploy and inspect checkout-worker queue depth.",
            status: "completed",
            evidence: "142ms latency and $0.020 estimated LLM cost."
          }
        ]
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Streaming" }).click();
  await expect(page.getByRole("heading", { name: "Create stream event" })).toBeVisible();

  await page.getByLabel("Event summary").fill(createdEvent.summary);
  await page.getByRole("button", { name: "Create Event" }).click();

  await expect(page.getByText(`Created stream event ${createdEvent.id}`)).toBeVisible();
  await expect(page.getByText(createdEvent.summary)).toBeVisible();
  await expect(page.getByText("91% confidence")).toBeVisible();

  await page.getByRole("button", { name: "Agent Builder" }).click();
  await expect(page.getByText(createdEvent.summary)).toBeVisible();

  await page.getByRole("button", { name: "Run Agent" }).click();
  await expect(page.locator(".run-result-card").getByText("run_evt_created_checkout")).toBeVisible();
  await expect(page.locator(".run-result-card").getByText("Review the payment deploy")).toBeVisible();
  await expect(page.locator(".run-result-card").getByText("2 audited steps")).toBeVisible();
});

test("admin console switches tenants, tests integrations, and exports audit CSV", async ({ page }) => {
  let auditLogs = [
    {
      id: "audit_seed_tenant_acme_fintech",
      tenant_id: "tenant_acme_fintech",
      actor: "system",
      action: "tenant.seeded",
      target: "tenant_acme_fintech",
      status: "completed",
      detail: "Seeded tenant workspace.",
      created_at: "2026-05-24T10:00:00Z"
    }
  ];

  await page.route("**/api/v1/tenants", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "tenant_northstar_health",
          name: "Northstar Health",
          industry: "Healthtech",
          plan: "Enterprise",
          region: "us-east-1",
          budget_cents: 5000,
          provider_mode: "groq-ready",
          user_count: 42,
          integration_count: 3
        },
        {
          id: "tenant_acme_fintech",
          name: "Acme Fintech",
          industry: "Fintech",
          plan: "Scale",
          region: "us-west-2",
          budget_cents: 8000,
          provider_mode: "local-safe",
          user_count: 31,
          integration_count: 2
        }
      ])
    });
  });

  await page.route("**/api/v1/admin/summary**", async (route) => {
    const url = new URL(route.request().url());
    const tenantId = url.searchParams.get("tenant_id") ?? "tenant_northstar_health";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tenant_id: tenantId,
        tenant_name: tenantId === "tenant_acme_fintech" ? "Acme Fintech" : "Northstar Health",
        tenant_count: 2,
        agents: 2,
        events: 3,
        documents: 2,
        approvals_pending: 1,
        runs: 4,
        integrations_configured: 2,
        token_spend_cents: 42
      })
    });
  });

  await page.route("**/api/v1/integrations", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "slack", name: "Slack incident channel", configured: false, mode: "dry-run", description: "Post agent summaries.", last_result: "No key configured, dry-run enabled" },
        { id: "github", name: "GitHub issue automation", configured: false, mode: "dry-run", description: "Open engineering issues.", last_result: "No key configured, dry-run enabled" },
        { id: "pagerduty", name: "PagerDuty incident trigger", configured: false, mode: "dry-run", description: "Trigger on-call incidents.", last_result: "No key configured, dry-run enabled" }
      ])
    });
  });

  await page.route("**/api/v1/audit-logs**", async (route) => {
    if (route.request().url().includes("/export")) {
      await route.fulfill({
        contentType: "text/csv",
        headers: { "Content-Disposition": "attachment; filename=\"audit-logs.csv\"" },
        body: "id,tenant_id,actor,action,target,status,detail,created_at\naudit_slack,tenant_acme_fintech,admin,integration.slack.test,slack,prepared,Slack payload prepared,2026-05-24T10:05:00Z\n"
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(auditLogs)
    });
  });

  await page.route("**/api/v1/integrations/slack/test**", async (route) => {
    auditLogs = [
      {
        id: "audit_slack",
        tenant_id: "tenant_acme_fintech",
        actor: "admin",
        action: "integration.slack.test",
        target: "#ai-ops-incidents",
        status: "prepared",
        detail: "Slack payload prepared. Add SLACK_WEBHOOK_URL to send it live.",
        created_at: "2026-05-24T10:05:00Z"
      },
      ...auditLogs
    ];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        integration_id: "slack",
        mode: "dry-run",
        status: "prepared",
        message: "Slack payload prepared. Add SLACK_WEBHOOK_URL to send it live.",
        payload: { text: "[tenant_acme_fintech] validation" }
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Admin Console" }).click();
  await expect(page.getByRole("heading", { name: "Manage tenants, integrations, and audit evidence." })).toBeVisible();

  await page.locator(".admin-tenant-switch select").selectOption("tenant_acme_fintech");
  await expect(page.getByText("Acme Fintech control room")).toBeVisible();
  await expect(page.getByText("Fintech • Scale • us-west-2")).toBeVisible();

  await page.locator(".integration-card").filter({ hasText: "Slack incident channel" }).getByRole("button", { name: "Send test" }).click();
  await expect(page.locator(".integration-result").getByText("Slack payload prepared. Add SLACK_WEBHOOK_URL to send it live.")).toBeVisible();
  await expect(page.getByText("integration.slack.test")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("audit");
});

test("approvals page persists approve and reject decisions", async ({ page }) => {
  let approvals = [
    {
      id: "approval_restart_checkout",
      tenant_id: "tenant_demo",
      action: "Restart checkout-worker deployment",
      risk: "high",
      reason: "Agent matched pool exhaustion runbook with high confidence.",
      status: "pending"
    }
  ];

  await page.route(/http:\/\/127\.0\.0\.1:8000\/api\/v1\/approvals(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(approvals)
    });
  });

  await page.route("**/api/v1/approvals/approval_restart_checkout/approve**", async (route) => {
    approvals = [{ ...approvals[0], status: "approved" }];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(approvals[0])
    });
  });

  await page.route("**/api/v1/approvals/approval_restart_checkout/reject**", async (route) => {
    approvals = [{ ...approvals[0], status: "rejected" }];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(approvals[0])
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Approvals" }).click();

  const card = page.locator(".approval-card").filter({ hasText: "Restart checkout-worker deployment" });
  await expect(card.getByText("pending")).toBeVisible();

  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("approved", { exact: true })).toBeVisible();
  await expect(card.getByText("Approved and persisted")).toBeVisible();
  await expect(card.getByRole("button", { name: "Reject" })).toBeHidden();
  await expect(page.getByText("Approved: Restart checkout-worker deployment")).toBeVisible();

  approvals = [{ ...approvals[0], status: "pending" }];
  await page.reload();
  await page.getByRole("button", { name: "Approvals" }).click();
  await expect(card.getByText("pending", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Reject" }).click();
  await expect(card.getByText("rejected", { exact: true })).toBeVisible();
  await expect(card.getByText("Rejected and persisted")).toBeVisible();
  await expect(card.getByRole("button", { name: "Approve" })).toBeHidden();
  await expect(page.getByText("Rejected: Restart checkout-worker deployment")).toBeVisible();
});

test("marketplace roi security and onboarding upgrades work", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Marketplace" }).click();
  await expect(page.getByText("Security Alert Agent")).toBeVisible();
  await page.locator(".template-card").filter({ hasText: "Security Alert Agent" }).getByRole("button", { name: "Deploy" }).click();
  await expect(page.getByText("Security Alert Agent deployed with 3 tools and 3 guardrails.")).toBeVisible();

  await page.getByRole("button", { name: "ROI" }).click();
  await expect(page.getByText("$4,387")).toBeVisible();
  await expect(page.getByText("Incident triage and runbook retrieval")).toBeVisible();

  await page.getByRole("button", { name: "Security Center" }).click();
  await expect(page.getByText("API keys")).toBeVisible();
  await expect(page.getByText("integration.slack.test")).toBeVisible();

  await page.getByRole("button", { name: "Admin Console" }).click();
  await page.getByRole("button", { name: "Prepare onboarding" }).click();
  await expect(page.getByText("HelioPay is ready to onboard")).toBeVisible();
  await expect(page.getByText("Invite admin founder@heliopay.local")).toBeVisible();
});
