from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..core.config import settings


def production_warnings() -> list[str]:
    warnings: list[str] = []

    if settings.app_env == "production":
        if settings.database_url.startswith("sqlite"):
            warnings.append("DATABASE_URL uses SQLite. Production should use PostgreSQL.")
        if settings.jwt_secret in {"", "replace-me"}:
            warnings.append("JWT_SECRET is not production-grade.")
        if "*" in settings.cors_origins:
            warnings.append("CORS allows every origin.")
        if not (settings.openai_api_key or settings.anthropic_api_key or settings.groq_api_key):
            warnings.append("No live LLM provider key is configured.")

    if settings.slack_webhook_url is None:
        warnings.append("SLACK_WEBHOOK_URL is not configured; Slack runs in dry-run mode.")
    if settings.github_token is None or settings.github_repo is None:
        warnings.append("GitHub integration is not fully configured; GitHub runs in dry-run mode.")
    if settings.pagerduty_routing_key is None:
        warnings.append("PAGERDUTY_ROUTING_KEY is not configured; PagerDuty runs in dry-run mode.")

    return warnings


def readiness_report(db: Session) -> dict[str, object]:
    db.execute(text("SELECT 1"))
    warnings = production_warnings()

    return {
        "status": "ready" if settings.app_env != "production" or not warnings else "degraded",
        "environment": settings.app_env,
        "checks": {
            "database": "ok",
            "api": "ok",
            "tenant_mode": "enabled",
            "llm_provider": settings.llm_provider_mode,
            "database_engine": "sqlite" if settings.database_url.startswith("sqlite") else "postgresql",
        },
        "warnings": warnings,
    }
