import logging

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    app_env: str = "development"
    jwt_issuer: str = "enterprise-ai-ops-hub"
    cors_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://[::1]:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://[::1]:5174",
    ]
    cors_origin_regex: str = r"http://(127\.0\.0\.1|localhost|\[::1\]):[0-9]+"
    demo_tenant_id: str = "tenant_northstar_health"
    database_url: str = "sqlite:///./ai_ops_hub.db"
    redis_url: str = "redis://localhost:6379/0"
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_events_topic: str = "ops.events"
    jwt_secret: str = "replace-me"
    access_token_ttl_minutes: int = 8 * 60
    password_reset_ttl_minutes: int = 15
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    llm_provider_mode: str = "local"
    rate_limit_enabled: bool = True
    slack_webhook_url: str | None = None
    github_token: str | None = None
    github_repo: str | None = None
    pagerduty_routing_key: str | None = None

    @model_validator(mode="after")
    def _validate_jwt_secret(self) -> "Settings":
        if self.jwt_secret == "replace-me":
            if self.app_env != "development":
                raise ValueError(
                    "JWT_SECRET must be set to a strong random value in non-development environments. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
                )
            logger.warning(
                "JWT_SECRET is using the insecure default 'replace-me'. "
                "This is only acceptable in development. Set a real secret in .env before deploying."
            )
        return self

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
