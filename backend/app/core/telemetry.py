from contextlib import nullcontext
from typing import Any


class _NoopTracer:
    def start_as_current_span(self, _: str):
        return nullcontext(_NoopSpan())


class _NoopSpan:
    def set_attribute(self, _: str, __: Any) -> None:
        return None


tracer: Any = _NoopTracer()


def setup_telemetry(app: Any) -> None:
    global tracer

    try:
        from opentelemetry import trace
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
    except Exception:
        return

    resource = Resource(attributes={"service.name": "enterprise-ai-ops-hub"})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
    tracer = trace.get_tracer("ai-ops-hub")
