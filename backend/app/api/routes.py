import asyncio
import io
import json
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import SessionLocal, get_db
from ..core.rate_limit import limiter
from ..models.schemas import (
    Agent,
    AgentRun,
    AgentTemplate,
    AgentTemplateDeployResult,
    AgentTrace,
    AdminSummary,
    AuditLog,
    AuthSession,
    AuthUser,
    ApprovalRequest,
    ChatRequest,
    ChatResponse,
    Document,
    DocumentUploadResult,
    IntegrationActionRequest,
    IntegrationActionResult,
    IntegrationStatus,
    LoginRequest,
    OnboardingRequest,
    OnboardingResult,
    PasswordResetConfirmRequest,
    PasswordResetConfirmResponse,
    PasswordResetRequest,
    PasswordResetStartResponse,
    ProviderConfig,
    ProviderStatus,
    RetrievalResponse,
    RoiSummary,
    SecuritySummary,
    StreamEvent,
    StreamEventCreate,
    Tenant,
)
from ..services.agent_runtime import AgentRuntime
from ..services.auth import (
    authenticate_user,
    begin_password_reset,
    clear_session_cookie,
    confirm_password_reset,
    get_current_user,
    get_user_from_token,
    require_tenant_access,
    set_session_cookie,
)
from ..services.integrations import execute_integration, list_integrations
from ..services.llm_providers import LLMRouter
from ..services.rag import RagService
from ..services.repository import (
    audit_logs_to_csv,
    build_agent_trace,
    build_admin_summary,
    build_roi_summary,
    build_security_summary,
    create_onboarding_dry_run,
    delete_document,
    deploy_agent_template,
    get_agent_trace,
    get_stream_event,
    list_audit_logs,
    list_agent_runs,
    list_agents,
    list_agent_templates,
    list_approvals,
    list_documents,
    list_stream_events,
    list_tenants,
    record_audit,
    reindex_document,
    save_agent_run,
    save_agent_trace,
    update_approval_status,
    upsert_stream_event,
)
from ..services.stream_manager import stream_manager

router = APIRouter()
runtime = AgentRuntime()
rag_service = RagService()
llm_router = LLMRouter()


def default_tenant_id(tenant_id: str = Query(default=settings.demo_tenant_id)) -> str:
    return tenant_id


@router.post("/auth/login", response_model=AuthSession)
@limiter.limit("10/minute")
async def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: Session = Depends(get_db),
) -> AuthSession:
    session = authenticate_user(db, payload)
    set_session_cookie(response, session.access_token, datetime.fromisoformat(session.expires_at))
    return session


@router.post("/auth/logout", status_code=204)
async def logout(response: Response) -> None:
    clear_session_cookie(response)


@router.post("/auth/password-reset/request", response_model=PasswordResetStartResponse)
async def request_password_reset(payload: PasswordResetRequest, db: Session = Depends(get_db)) -> PasswordResetStartResponse:
    return begin_password_reset(db, payload)


@router.post("/auth/password-reset/confirm", response_model=PasswordResetConfirmResponse)
async def reset_password(
    payload: PasswordResetConfirmRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> PasswordResetConfirmResponse:
    clear_session_cookie(response)
    return confirm_password_reset(db, payload)


@router.get("/auth/me", response_model=AuthUser)
async def me(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    return user


@router.get("/tenants", response_model=list[Tenant])
async def tenants(user: AuthUser = Depends(get_current_user)) -> list[Tenant]:
    if user.role == "Admin":
        return list_tenants()
    allowed = {membership.tenant_id for membership in user.memberships}
    return [tenant for tenant in list_tenants() if tenant.id in allowed]


@router.get("/admin/summary", response_model=AdminSummary)
async def admin_summary(
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> AdminSummary:
    require_tenant_access(user, tenant_id, {"Admin"})
    return build_admin_summary(db, tenant_id=tenant_id)


@router.get("/audit-logs", response_model=list[AuditLog])
async def audit_logs(
    tenant_id: str = Depends(default_tenant_id),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> list[AuditLog]:
    require_tenant_access(user, tenant_id, {"Admin"})
    return list_audit_logs(db, tenant_id=tenant_id, limit=limit, offset=offset)


@router.get("/audit-logs/export")
async def export_audit_logs(
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> Response:
    require_tenant_access(user, tenant_id, {"Admin"})
    csv_body = audit_logs_to_csv(list_audit_logs(db, tenant_id=tenant_id))
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="audit-{tenant_id}.csv"'},
    )


@router.get("/integrations", response_model=list[IntegrationStatus])
async def integrations(user: AuthUser = Depends(get_current_user)) -> list[IntegrationStatus]:
    if user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can inspect integrations")
    return list_integrations()


@router.post("/onboarding", response_model=OnboardingResult)
async def onboarding(
    payload: OnboardingRequest,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> OnboardingResult:
    require_tenant_access(user, tenant_id, {"Admin"})
    return create_onboarding_dry_run(db, payload=payload, actor=user.email, tenant_id=tenant_id)


@router.get("/agent-templates", response_model=list[AgentTemplate])
async def agent_templates(
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> list[AgentTemplate]:
    require_tenant_access(user, tenant_id)
    return list_agent_templates(db, tenant_id=tenant_id)


@router.post("/agent-templates/{template_id}/deploy", response_model=AgentTemplateDeployResult)
async def deploy_template(
    template_id: str,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> AgentTemplateDeployResult:
    require_tenant_access(user, tenant_id, {"Admin"})
    result = deploy_agent_template(db, tenant_id=tenant_id, template_id=template_id, actor=user.email)
    if not result:
        raise HTTPException(status_code=404, detail="Agent template not found")
    return result


@router.get("/security/summary", response_model=SecuritySummary)
async def security_summary(
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> SecuritySummary:
    require_tenant_access(user, tenant_id, {"Admin", "SRE"})
    return build_security_summary(db, tenant_id=tenant_id)


@router.get("/roi", response_model=RoiSummary)
async def roi(
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> RoiSummary:
    require_tenant_access(user, tenant_id)
    return build_roi_summary(db, tenant_id=tenant_id)


@router.post("/integrations/{integration_id}/test", response_model=IntegrationActionResult)
async def test_integration(
    integration_id: str,
    payload: IntegrationActionRequest,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> IntegrationActionResult:
    require_tenant_access(user, tenant_id, {"Admin"})
    try:
        result = await execute_integration(
            integration_id,
            tenant_id=tenant_id,
            summary=payload.summary,
            target=payload.target,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    record_audit(
        db,
        tenant_id=tenant_id,
        actor=user.email,
        action=f"integration.{integration_id}.test",
        target=payload.target or integration_id,
        status=result.status,
        detail=result.message,
    )
    return result


@router.get("/providers", response_model=ProviderConfig)
async def providers(user: AuthUser = Depends(get_current_user)) -> ProviderConfig:
    return ProviderConfig(
        selected_provider=settings.llm_provider_mode,
        providers=[
            ProviderStatus(
                id="local",
                label="Local simulator",
                model="local-enterprise-simulator",
                available=True,
                mode="offline",
            ),
            ProviderStatus(
                id="openai",
                label="OpenAI",
                model="gpt-4o-mini",
                available=bool(settings.openai_api_key),
                mode="live" if settings.openai_api_key else "fallback",
            ),
            ProviderStatus(
                id="groq",
                label="Groq",
                model=settings.groq_model,
                available=bool(settings.groq_api_key),
                mode="live" if settings.groq_api_key else "fallback",
            ),
            ProviderStatus(
                id="anthropic",
                label="Anthropic",
                model="claude-3-5-sonnet-latest",
                available=bool(settings.anthropic_api_key),
                mode="live" if settings.anthropic_api_key else "fallback",
            ),
        ],
    )


@router.get("/agents", response_model=list[Agent])
async def agents(
    tenant_id: str = Depends(default_tenant_id),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> list[Agent]:
    require_tenant_access(user, tenant_id)
    return list_agents(db, tenant_id=tenant_id, limit=limit, offset=offset)


@router.get("/events", response_model=list[StreamEvent])
async def events(
    tenant_id: str = Depends(default_tenant_id),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> list[StreamEvent]:
    require_tenant_access(user, tenant_id)
    return list_stream_events(db, tenant_id=tenant_id, limit=limit, offset=offset)


@router.post("/events", response_model=StreamEvent, status_code=201)
async def create_event(
    payload: StreamEventCreate,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> StreamEvent:
    require_tenant_access(user, tenant_id, {"Admin", "SRE"})
    event = StreamEvent(
        id=f"evt_{uuid4().hex[:10]}",
        tenant_id=tenant_id,
        topic=payload.topic,
        severity=payload.severity,
        summary=payload.summary,
        assigned_agent_id=payload.assigned_agent_id,
        confidence=payload.confidence,
    )
    created = upsert_stream_event(db, event)
    await stream_manager.broadcast(tenant_id, created.model_dump())
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=user.email,
        action="event.created",
        target=created.id,
        status="created",
        detail=created.summary,
    )
    return created


@router.get("/approvals", response_model=list[ApprovalRequest])
async def approvals(
    tenant_id: str = Depends(default_tenant_id),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> list[ApprovalRequest]:
    require_tenant_access(user, tenant_id)
    return list_approvals(db, tenant_id=tenant_id, limit=limit, offset=offset)


@router.post("/approvals/{approval_id}/approve", response_model=ApprovalRequest)
async def approve_approval(
    approval_id: str,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> ApprovalRequest:
    require_tenant_access(user, tenant_id, {"Admin", "SRE", "Support Lead"})
    approval = update_approval_status(db, approval_id, "approved", tenant_id=tenant_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=user.email,
        action="approval.approved",
        target=approval.id,
        status="approved",
        detail=approval.action,
    )
    return approval


@router.post("/approvals/{approval_id}/reject", response_model=ApprovalRequest)
async def reject_approval(
    approval_id: str,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> ApprovalRequest:
    require_tenant_access(user, tenant_id, {"Admin", "SRE", "Support Lead"})
    approval = update_approval_status(db, approval_id, "rejected", tenant_id=tenant_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=user.email,
        action="approval.rejected",
        target=approval.id,
        status="rejected",
        detail=approval.action,
    )
    return approval


@router.post("/events/{event_id}/run", response_model=AgentRun)
async def run_agent(
    event_id: str,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> AgentRun:
    require_tenant_access(user, tenant_id, {"Admin", "SRE", "Support Lead"})
    event = get_stream_event(db, event_id, tenant_id=tenant_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    run = await runtime.run(event, db)
    saved_run = save_agent_run(db, run)
    save_agent_trace(db, build_agent_trace(event, saved_run))
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=user.email,
        action="agent.run",
        target=saved_run.id,
        status="completed",
        detail=saved_run.recommended_action,
    )
    return saved_run


@router.get("/runs", response_model=list[AgentRun])
async def runs(
    tenant_id: str = Depends(default_tenant_id),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> list[AgentRun]:
    require_tenant_access(user, tenant_id)
    return list_agent_runs(db, tenant_id=tenant_id, limit=limit, offset=offset)


@router.get("/runs/{run_id}/trace", response_model=AgentTrace)
async def run_trace(
    run_id: str,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> AgentTrace:
    require_tenant_access(user, tenant_id)
    trace = get_agent_trace(db, run_id, tenant_id=tenant_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace


@router.get("/documents", response_model=list[Document])
async def documents(
    tenant_id: str = Depends(default_tenant_id),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> list[Document]:
    require_tenant_access(user, tenant_id)
    return list_documents(db, tenant_id=tenant_id, limit=limit, offset=offset)


@router.post("/documents/upload", response_model=DocumentUploadResult, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> DocumentUploadResult:
    require_tenant_access(user, tenant_id, {"Admin", "SRE"})
    raw = await file.read()
    filename = file.filename or "upload"
    extension = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    allowed_extensions = {"txt", "md", "markdown", "pdf"}
    if extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '.{extension}'. Allowed: {sorted(allowed_extensions)}")

    if extension == "pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(raw))
            content = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not parse PDF: {exc}") from exc
    else:
        content = raw.decode("utf-8", errors="ignore")

    if not content.strip():
        raise HTTPException(status_code=400, detail="Document is empty or not text-readable")
    result = rag_service.ingest_text(
        db,
        tenant_id=tenant_id,
        title=title or filename,
        source_type=extension,
        content=content,
    )
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=user.email,
        action="document.uploaded",
        target=result.id,
        status="indexed",
        detail=f"{result.title} indexed into {result.chunk_count} chunk(s).",
    )
    return result


@router.post("/documents/{document_id}/reindex", response_model=DocumentUploadResult)
async def reindex_document_endpoint(
    document_id: str,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> DocumentUploadResult:
    require_tenant_access(user, tenant_id, {"Admin", "SRE"})
    result = reindex_document(db, document_id=document_id, tenant_id=tenant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=user.email,
        action="document.reindexed",
        target=result.id,
        status="indexed",
        detail=f"{result.title} re-indexed.",
    )
    return result


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document_endpoint(
    document_id: str,
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> None:
    require_tenant_access(user, tenant_id, {"Admin", "SRE"})
    deleted = delete_document(db, document_id=document_id, tenant_id=tenant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    record_audit(
        db,
        tenant_id=tenant_id,
        actor=user.email,
        action="document.deleted",
        target=document_id,
        status="deleted",
        detail="Document and chunks removed from tenant index.",
    )


@router.get("/rag/query", response_model=RetrievalResponse)
async def rag_query(
    query: str,
    provider: str = "local",
    tenant_id: str = Depends(default_tenant_id),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> RetrievalResponse:
    require_tenant_access(user, tenant_id)
    if not query.strip():
        raise HTTPException(status_code=400, detail="Query is required")
    return await rag_service.answer(db, tenant_id=tenant_id, query=query, provider=provider)


@router.post("/llm/complete", response_model=ChatResponse)
async def complete(payload: ChatRequest, user: AuthUser = Depends(get_current_user)) -> ChatResponse:
    completion = await llm_router.complete(payload.prompt, provider=payload.provider)
    return ChatResponse(
        provider=completion.provider,
        model=completion.model,
        content=completion.content,
        token_cost_cents=completion.token_cost_cents,
    )


@router.get("/llm/stream")
async def stream_complete(
    prompt: str,
    provider: str = "local",
    user: AuthUser = Depends(get_current_user),
) -> StreamingResponse:
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")

    async def event_generator():
        selected_provider = provider if provider in {"local", "openai", "anthropic", "groq"} else "local"

        if selected_provider == "openai" and settings.openai_api_key:
            import httpx

            async with httpx.AsyncClient(timeout=60) as client:
                async with client.stream(
                    "POST",
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": True,
                        "temperature": 0.2,
                    },
                ) as response:
                    async for line in response.aiter_lines():
                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                payload = json.loads(line[6:])
                                token = payload["choices"][0]["delta"].get("content", "")
                            except Exception:
                                token = ""
                            if token:
                                yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
            return

        completion = await llm_router.complete(prompt, provider=selected_provider)
        words = completion.content.split()
        if not words:
            yield f"data: {json.dumps({'done': True})}\n\n"
            return
        for index, word in enumerate(words):
            token = word + (" " if index < len(words) - 1 else "")
            yield f"data: {json.dumps({'token': token})}\n\n"
            await asyncio.sleep(0.04)
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.websocket("/stream")
async def stream(websocket: WebSocket) -> None:
    tenant_id = websocket.query_params.get("tenant_id", settings.demo_tenant_id)
    token = websocket.query_params.get("token", "")

    with SessionLocal() as db:
        user = get_user_from_token(db, token)
        if not user:
            await websocket.close(code=1008, reason="Authentication required")
            return
        try:
            require_tenant_access(user, tenant_id)
        except HTTPException:
            await websocket.close(code=1008, reason="Tenant access denied")
            return
        initial_events = list_stream_events(db, tenant_id=tenant_id)

    await stream_manager.connect(tenant_id, websocket)
    try:
        for event in initial_events:
            await websocket.send_json(event.model_dump())
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        return
    finally:
        await stream_manager.disconnect(tenant_id, websocket)
