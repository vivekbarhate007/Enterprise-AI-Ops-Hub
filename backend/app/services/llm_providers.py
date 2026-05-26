from dataclasses import dataclass

import httpx

from ..core.config import settings


@dataclass(frozen=True)
class LLMCompletion:
    provider: str
    model: str
    content: str
    token_cost_cents: int


class LocalProvider:
    name = "local"
    model = "local-enterprise-simulator"

    async def complete(self, prompt: str) -> LLMCompletion:
        compact = " ".join(prompt.split())
        if "checkout" in compact.lower() or "latency" in compact.lower():
            content = (
                "The strongest evidence points to checkout latency caused by database pool saturation. "
                "Use the Checkout Latency Runbook and Postgres RCA as sources, inspect connection pools, "
                "and require SRE approval before restarting workers."
            )
        else:
            content = (
                "The answer is grounded in the uploaded tenant knowledge. Review the cited sources, "
                "apply the configured guardrails, and route risky actions through approval."
            )
        return LLMCompletion(provider=self.name, model=self.model, content=content, token_cost_cents=0)


class OpenAIProvider:
    name = "openai"
    model = "gpt-4o-mini"

    async def complete(self, prompt: str) -> LLMCompletion:
        if not settings.openai_api_key:
            return await LocalProvider().complete(prompt)
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": "You are an enterprise AI operations assistant."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.2,
                },
            )
        response.raise_for_status()
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        return LLMCompletion(provider=self.name, model=self.model, content=content, token_cost_cents=1)


class GroqProvider:
    name = "groq"

    @property
    def model(self) -> str:
        return settings.groq_model

    async def complete(self, prompt: str) -> LLMCompletion:
        if not settings.groq_api_key:
            return await LocalProvider().complete(prompt)
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": "You are an enterprise AI operations assistant. Answer using the provided tenant context and cite operational evidence."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.2,
                },
            )
        response.raise_for_status()
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        return LLMCompletion(provider=self.name, model=self.model, content=content, token_cost_cents=1)


class AnthropicProvider:
    name = "anthropic"
    model = "claude-3-5-sonnet-latest"

    async def complete(self, prompt: str) -> LLMCompletion:
        if not settings.anthropic_api_key:
            return await LocalProvider().complete(prompt)
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": self.model,
                    "max_tokens": 700,
                    "temperature": 0.2,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
        response.raise_for_status()
        payload = response.json()
        content = "".join(block.get("text", "") for block in payload.get("content", []))
        return LLMCompletion(provider=self.name, model=self.model, content=content, token_cost_cents=2)


class LLMRouter:
    def __init__(self) -> None:
        self.providers = {
            "local": LocalProvider(),
            "groq": GroqProvider(),
            "openai": OpenAIProvider(),
            "anthropic": AnthropicProvider(),
        }

    async def complete(self, prompt: str, provider: str = "local") -> LLMCompletion:
        selected = self.providers.get(provider, self.providers["local"])
        return await selected.complete(prompt)
