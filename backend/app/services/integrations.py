from __future__ import annotations

import httpx

from ..core.config import settings
from ..models.schemas import IntegrationActionResult, IntegrationStatus


def list_integrations() -> list[IntegrationStatus]:
    configs = [
        (
            "slack",
            "Slack incident channel",
            bool(settings.slack_webhook_url),
            "Post agent summaries into an incident channel.",
        ),
        (
            "github",
            "GitHub issue automation",
            bool(settings.github_token and settings.github_repo),
            "Open engineering issues with tenant, trace, and runbook context.",
        ),
        (
            "pagerduty",
            "PagerDuty incident trigger",
            bool(settings.pagerduty_routing_key),
            "Trigger on-call incidents for high-risk events.",
        ),
    ]

    return [
        IntegrationStatus(
            id=integration_id,
            name=name,
            configured=configured,
            mode="live" if configured else "dry-run",
            description=description,
            last_result="Ready for live execution" if configured else "No key configured, dry-run enabled",
        )
        for integration_id, name, configured, description in configs
    ]


async def execute_integration(
    integration_id: str,
    *,
    tenant_id: str,
    summary: str,
    target: str | None = None,
) -> IntegrationActionResult:
    if integration_id == "slack":
        payload: dict[str, object] = {
            "text": f"[{tenant_id}] {summary}",
            "target": target or "#incident-ai-ops",
        }
        if settings.slack_webhook_url:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(settings.slack_webhook_url, json={"text": payload["text"]})
                response.raise_for_status()
            return IntegrationActionResult(
                integration_id=integration_id,
                mode="live",
                status="sent",
                message="Slack incident update sent.",
                payload=payload,
            )
        return IntegrationActionResult(
            integration_id=integration_id,
            mode="dry-run",
            status="prepared",
            message="Slack payload prepared. Add SLACK_WEBHOOK_URL to send it live.",
            payload=payload,
        )

    if integration_id == "github":
        payload = {
            "title": f"AI Ops follow-up: {summary[:72]}",
            "body": f"Tenant: {tenant_id}\n\nSummary: {summary}\n\nTarget: {target or 'engineering triage'}",
            "labels": ["ai-ops", "tenant-incident"],
        }
        if settings.github_token and settings.github_repo:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    f"https://api.github.com/repos/{settings.github_repo}/issues",
                    headers={
                        "Authorization": f"Bearer {settings.github_token}",
                        "Accept": "application/vnd.github+json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                created = response.json()
            payload["issue_url"] = created.get("html_url", "")
            return IntegrationActionResult(
                integration_id=integration_id,
                mode="live",
                status="created",
                message="GitHub issue created.",
                payload=payload,
            )
        return IntegrationActionResult(
            integration_id=integration_id,
            mode="dry-run",
            status="prepared",
            message="GitHub issue payload prepared. Add GITHUB_TOKEN and GITHUB_REPO to create it live.",
            payload=payload,
        )

    if integration_id == "pagerduty":
        payload = {
            "routing_key": "***configured***" if settings.pagerduty_routing_key else "***dry-run***",
            "event_action": "trigger",
            "payload": {
                "summary": summary,
                "source": "enterprise-ai-ops-hub",
                "severity": "critical",
                "custom_details": {"tenant_id": tenant_id, "target": target or "on-call"},
            },
        }
        if settings.pagerduty_routing_key:
            live_payload = {**payload, "routing_key": settings.pagerduty_routing_key}
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post("https://events.pagerduty.com/v2/enqueue", json=live_payload)
                response.raise_for_status()
            return IntegrationActionResult(
                integration_id=integration_id,
                mode="live",
                status="triggered",
                message="PagerDuty incident event triggered.",
                payload=payload,
            )
        return IntegrationActionResult(
            integration_id=integration_id,
            mode="dry-run",
            status="prepared",
            message="PagerDuty trigger payload prepared. Add PAGERDUTY_ROUTING_KEY to trigger it live.",
            payload=payload,
        )

    raise ValueError(f"Unsupported integration: {integration_id}")
