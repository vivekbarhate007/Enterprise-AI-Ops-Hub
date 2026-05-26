import os
from pathlib import Path

from fastapi.testclient import TestClient

TEST_DB = Path("test_ai_ops_hub.db")
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///./{TEST_DB}"
os.environ["RATE_LIMIT_ENABLED"] = "false"

from backend.app.main import app, initialize_app_data


initialize_app_data()
client = TestClient(app)


def auth_headers(email: str = "admin@aiopshub.local", password: str = "admin123") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


client.headers.update(auth_headers())


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_reports_database_and_environment() -> None:
    response = client.get("/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"ready", "degraded"}
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["tenant_mode"] == "enabled"
    assert isinstance(body["warnings"], list)


def test_login_and_me_return_memberships() -> None:
    response = client.post("/api/v1/auth/login", json={"email": "sre@aiopshub.local", "password": "sre123"})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "SRE"
    assert body["expires_at"]
    assert "aiops_session" in response.cookies
    assert any(membership["tenant_id"] == "tenant_northstar_health" for membership in body["user"]["memberships"])

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "sre@aiopshub.local"

    cookie_client = TestClient(app)
    cookie_client.cookies.set("aiops_session", response.cookies["aiops_session"])
    cookie_me = cookie_client.get("/api/v1/auth/me")
    assert cookie_me.status_code == 200
    assert cookie_me.json()["email"] == "sre@aiopshub.local"


def test_password_reset_flow_uses_single_use_token() -> None:
    request = client.post("/api/v1/auth/password-reset/request", json={"email": "viewer@aiopshub.local"})
    assert request.status_code == 200
    reset_token = request.json()["reset_token"]
    assert reset_token

    confirm = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": reset_token, "new_password": "viewer456"},
    )
    assert confirm.status_code == 200

    reused = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": reset_token, "new_password": "viewer789"},
    )
    assert reused.status_code == 400

    old_login = client.post("/api/v1/auth/login", json={"email": "viewer@aiopshub.local", "password": "viewer123"})
    assert old_login.status_code == 401

    new_login = client.post("/api/v1/auth/login", json={"email": "viewer@aiopshub.local", "password": "viewer456"})
    assert new_login.status_code == 200

    restore = client.post("/api/v1/auth/password-reset/request", json={"email": "viewer@aiopshub.local"})
    restore_token = restore.json()["reset_token"]
    restored = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": restore_token, "new_password": "viewer123"},
    )
    assert restored.status_code == 200


def test_protected_routes_require_authentication() -> None:
    anonymous_client = TestClient(app)
    response = anonymous_client.get("/api/v1/events")
    assert response.status_code == 401


def test_local_dev_cors_allows_alternate_vite_port() -> None:
    response = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://127.0.0.1:5174",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5174"


def test_viewer_cannot_mutate_tenant_data() -> None:
    viewer_headers = auth_headers("viewer@aiopshub.local", "viewer123")
    response = client.post(
        "/api/v1/events",
        headers=viewer_headers,
        json={
            "topic": "security.alerts",
            "severity": "medium",
            "summary": "Viewer should not create this event.",
            "assigned_agent_id": "agent_incident",
            "confidence": 0.77,
        },
    )
    assert response.status_code == 403


def test_tenant_membership_blocks_cross_tenant_reads() -> None:
    viewer_headers = auth_headers("viewer@aiopshub.local", "viewer123")
    response = client.get("/api/v1/events", params={"tenant_id": "tenant_acme_fintech"}, headers=viewer_headers)
    assert response.status_code == 403


def test_agents_are_tenant_scoped() -> None:
    response = client.get("/api/v1/agents")
    assert response.status_code == 200
    agents = response.json()
    assert agents
    assert all(agent["tenant_id"].startswith("tenant_") for agent in agents)


def test_provider_config_exposes_fallback_status() -> None:
    response = client.get("/api/v1/providers")
    assert response.status_code == 200
    body = response.json()
    assert body["selected_provider"] in {"local", "groq", "openai", "anthropic"}
    provider_ids = {provider["id"] for provider in body["providers"]}
    assert {"local", "groq", "openai", "anthropic"}.issubset(provider_ids)
    assert any(provider["id"] == "local" and provider["available"] for provider in body["providers"])
    assert any(provider["id"] == "groq" and provider["mode"] in {"live", "fallback"} for provider in body["providers"])


def test_agent_marketplace_lists_and_deploys_template() -> None:
    templates = client.get("/api/v1/agent-templates")
    assert templates.status_code == 200
    body = templates.json()
    assert any(template["id"] == "tpl_security_alert" for template in body)

    deployed = client.post("/api/v1/agent-templates/tpl_security_alert/deploy")
    assert deployed.status_code == 200
    assert deployed.json()["status"] == "deployed"


def test_onboarding_security_and_roi_endpoints() -> None:
    onboarding = client.post(
        "/api/v1/onboarding",
        json={
            "company_name": "HelioPay",
            "industry": "Fintech",
            "admin_email": "founder@heliopay.local",
            "first_agent_template_id": "tpl_incident_triage",
            "first_data_source": "checkout-runbook.md",
        },
    )
    assert onboarding.status_code == 200
    assert onboarding.json()["status"] == "ready"

    security = client.get("/api/v1/security/summary")
    assert security.status_code == 200
    assert security.json()["events"]

    roi = client.get("/api/v1/roi")
    assert roi.status_code == 200
    assert roi.json()["estimated_monthly_value"] >= 0


def test_agent_run_returns_sources_and_approval_signal() -> None:
    response = client.post("/api/v1/events/evt_1092/run")
    assert response.status_code == 200
    body = response.json()
    assert body["approval_required"] is True
    assert body["sources"]


def test_agent_run_is_persisted() -> None:
    client.post("/api/v1/events/evt_1092/run")
    response = client.get("/api/v1/runs")
    assert response.status_code == 200
    assert any(run["event_id"] == "evt_1092" for run in response.json())


def test_agent_run_trace_is_persisted() -> None:
    run = client.post("/api/v1/events/evt_1092/run")
    assert run.status_code == 200
    run_id = run.json()["id"]

    response = client.get(f"/api/v1/runs/{run_id}/trace")
    assert response.status_code == 200
    trace = response.json()
    assert trace["run_id"] == run_id
    assert trace["event_id"] == "evt_1092"
    assert trace["approval_required"] is True
    assert len(trace["steps"]) >= 5
    assert any(step["title"] == "Knowledge retrieved" for step in trace["steps"])


def test_approval_approve_and_reject_persist() -> None:
    approvals = client.get("/api/v1/approvals")
    assert approvals.status_code == 200
    approval_id = approvals.json()[0]["id"]

    approve = client.post(f"/api/v1/approvals/{approval_id}/approve")
    assert approve.status_code == 200
    assert approve.json()["status"] == "approved"

    reject = client.post(f"/api/v1/approvals/{approval_id}/reject")
    assert reject.status_code == 200
    assert reject.json()["status"] == "rejected"

    refreshed = client.get("/api/v1/approvals")
    assert refreshed.status_code == 200
    matching = [approval for approval in refreshed.json() if approval["id"] == approval_id]
    assert matching[0]["status"] == "rejected"


def test_event_ingestion() -> None:
    response = client.post(
        "/api/v1/events",
        json={
            "topic": "security.alerts",
            "severity": "medium",
            "summary": "Suspicious login velocity detected for tenant admin.",
            "assigned_agent_id": "agent_incident",
            "confidence": 0.77,
        },
    )
    assert response.status_code == 201
    assert response.json()["topic"] == "security.alerts"


def test_document_upload_and_rag_query() -> None:
    upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("runbook.txt", b"Database pool saturation can cause checkout latency.", "text/plain")},
        data={"title": "Database Pool Runbook"},
    )
    assert upload.status_code == 201
    assert upload.json()["chunk_count"] == 1

    query = client.get("/api/v1/rag/query", params={"query": "What causes checkout latency?"})
    assert query.status_code == 200
    body = query.json()
    assert body["sources"]
    assert body["answer"]


def test_rtf_upload_is_cleaned_before_retrieval() -> None:
    upload = client.post(
        "/api/v1/documents/upload",
        files={
            "file": (
                "textedit-runbook.txt",
                br"{\rtf1\ansi{\fonttbl\f0\fswiss Helvetica;}\f0\fs24 Database pool saturation causes checkout latency.\par Restart requires SRE approval.}",
                "text/plain",
            )
        },
        data={"title": "TextEdit Runbook"},
    )
    assert upload.status_code == 201

    query = client.get("/api/v1/rag/query", params={"query": "What causes checkout latency?"})
    assert query.status_code == 200
    source_text = " ".join(source["text"] for source in query.json()["sources"])
    assert "\\rtf" not in source_text
    assert "fonttbl" not in source_text
    assert "Database pool saturation causes checkout latency" in source_text


def test_duplicate_document_titles_are_replaced_and_deduped() -> None:
    for _ in range(2):
        upload = client.post(
            "/api/v1/documents/upload",
            files={
                "file": (
                    "duplicate-runbook.txt",
                    b"Duplicate runbook says Redis cache misses can increase checkout latency.",
                    "text/plain",
                )
            },
            data={"title": "Duplicate Checkout Runbook"},
        )
        assert upload.status_code == 201

    documents = client.get("/api/v1/documents")
    assert documents.status_code == 200
    matching_documents = [
        document
        for document in documents.json()
        if document["title"] == "Duplicate Checkout Runbook"
    ]
    assert len(matching_documents) == 1

    query = client.get("/api/v1/rag/query", params={"query": "What increases checkout latency?"})
    assert query.status_code == 200
    matching_sources = [
        source
        for source in query.json()["sources"]
        if source["title"] == "Duplicate Checkout Runbook"
    ]
    assert len(matching_sources) <= 1


def test_retrieval_returns_one_source_per_document_title() -> None:
    long_text = " ".join(
        ["Checkout latency can happen when database pools are saturated."] * 30
    )
    upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("multi-chunk-runbook.txt", long_text.encode(), "text/plain")},
        data={"title": "Multi Chunk Checkout Runbook"},
    )
    assert upload.status_code == 201
    assert upload.json()["chunk_count"] > 1

    query = client.get("/api/v1/rag/query", params={"query": "Why is checkout latency high?"})
    assert query.status_code == 200
    matching_sources = [
        source
        for source in query.json()["sources"]
        if source["title"] == "Multi Chunk Checkout Runbook"
    ]
    assert len(matching_sources) == 1


def test_document_reindex_and_delete() -> None:
    upload = client.post(
        "/api/v1/documents/upload",
        files={
            "file": (
                "lifecycle-runbook.txt",
                b"Lifecycle runbook content about checkout latency and database pool saturation.",
                "text/plain",
            )
        },
        data={"title": "Lifecycle Runbook"},
    )
    assert upload.status_code == 201
    document_id = upload.json()["id"]

    reindex = client.post(f"/api/v1/documents/{document_id}/reindex")
    assert reindex.status_code == 200
    assert reindex.json()["id"] == document_id
    assert reindex.json()["chunk_count"] == upload.json()["chunk_count"]

    delete = client.delete(f"/api/v1/documents/{document_id}")
    assert delete.status_code == 204

    documents = client.get("/api/v1/documents")
    assert documents.status_code == 200
    assert all(document["id"] != document_id for document in documents.json())

    missing_delete = client.delete(f"/api/v1/documents/{document_id}")
    assert missing_delete.status_code == 404


def test_llm_provider_local_fallback() -> None:
    response = client.post("/api/v1/llm/complete", json={"prompt": "Explain checkout latency", "provider": "groq"})
    assert response.status_code == 200
    assert response.json()["content"]


def test_tenants_admin_integrations_and_audit_export() -> None:
    tenants = client.get("/api/v1/tenants")
    assert tenants.status_code == 200
    assert len(tenants.json()) >= 3

    tenant_id = "tenant_acme_fintech"
    events = client.get("/api/v1/events", params={"tenant_id": tenant_id})
    assert events.status_code == 200
    assert events.json()
    assert all(event["tenant_id"] == tenant_id for event in events.json())

    summary = client.get("/api/v1/admin/summary", params={"tenant_id": tenant_id})
    assert summary.status_code == 200
    assert summary.json()["tenant_name"] == "Acme Fintech"

    integrations = client.get("/api/v1/integrations")
    assert integrations.status_code == 200
    assert {"slack", "github", "pagerduty"}.issubset({integration["id"] for integration in integrations.json()})

    dry_run = client.post(
        "/api/v1/integrations/slack/test",
        params={"tenant_id": tenant_id},
        json={"summary": "Validate tenant incident notification.", "target": "#ai-ops-incidents"},
    )
    assert dry_run.status_code == 200
    assert dry_run.json()["mode"] in {"dry-run", "live"}

    logs = client.get("/api/v1/audit-logs", params={"tenant_id": tenant_id})
    assert logs.status_code == 200
    assert any(log["action"] == "integration.slack.test" for log in logs.json())

    export = client.get("/api/v1/audit-logs/export", params={"tenant_id": tenant_id})
    assert export.status_code == 200
    assert "text/csv" in export.headers["content-type"]
    assert "integration.slack.test" in export.text


def test_websocket_streams_events() -> None:
    token = auth_headers()["Authorization"].replace("Bearer ", "")
    with client.websocket_connect(f"/api/v1/stream?token={token}") as websocket:
        assert websocket.receive_json()["id"].startswith("evt_")
        created = client.post(
            "/api/v1/events",
            json={
                "topic": "platform.latency",
                "severity": "critical",
                "summary": "Live websocket verification event.",
                "assigned_agent_id": "agent_incident",
                "confidence": 0.91,
            },
        )
        assert created.status_code == 201
        pushed = websocket.receive_json()
        while pushed.get("type") == "ping" or pushed.get("id") != created.json()["id"]:
            pushed = websocket.receive_json()
        assert pushed["id"] == created.json()["id"]
