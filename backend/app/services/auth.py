from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..models.schemas import (
    AuthSession,
    AuthUser,
    LoginRequest,
    PasswordResetConfirmRequest,
    PasswordResetConfirmResponse,
    PasswordResetRequest,
    PasswordResetStartResponse,
)
from .passwords import verify_password
from .repository import (
    consume_password_reset_token,
    get_active_password_reset_token,
    get_auth_user,
    get_user_by_email,
    list_user_memberships,
    save_password_reset_token,
    update_user_password,
    user_from_record,
)

security = HTTPBearer(auto_error=False)
ALGORITHM = "HS256"
SESSION_COOKIE_NAME = "aiops_session"


def create_access_token(user: AuthUser) -> tuple[str, datetime]:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_ttl_minutes)
    token = jwt.encode(
        {
            "sub": user.id,
            "email": user.email,
            "role": user.role,
            "exp": expires_at,
            "iss": settings.jwt_issuer,
        },
        settings.jwt_secret,
        algorithm=ALGORITHM,
    )
    return token, expires_at


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def set_session_cookie(response: Response, token: str, expires_at: datetime) -> None:
    max_age = max(0, int((expires_at - datetime.now(UTC)).total_seconds()))
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        httponly=True,
        secure=settings.app_env != "development",
        samesite="lax",
        max_age=max_age,
        expires=max_age,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


def authenticate_user(db: Session, payload: LoginRequest) -> AuthSession:
    record = get_user_by_email(db, payload.email)
    if not record or not verify_password(payload.password, record.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    user = user_from_record(record, list_user_memberships(db, record.id))
    token, expires_at = create_access_token(user)
    return AuthSession(access_token=token, expires_at=expires_at.isoformat(), user=user)


def begin_password_reset(db: Session, payload: PasswordResetRequest) -> PasswordResetStartResponse:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.password_reset_ttl_minutes)
    generic = PasswordResetStartResponse(
        status="ok",
        message="If that email exists, a reset link has been prepared.",
    )
    record = get_user_by_email(db, payload.email)
    if not record:
        return generic

    token = secrets.token_urlsafe(32)
    save_password_reset_token(db, user_id=record.id, token_hash=_token_hash(token), expires_at=expires_at)
    response = PasswordResetStartResponse(
        status="ok",
        message="If that email exists, a reset link has been prepared.",
        expires_at=expires_at.isoformat(),
    )
    if settings.app_env in {"development", "test"}:
        response.reset_token = token
    return response


def confirm_password_reset(db: Session, payload: PasswordResetConfirmRequest) -> PasswordResetConfirmResponse:
    record = get_active_password_reset_token(db, _token_hash(payload.token))
    if not record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset token is invalid or expired")

    if not update_user_password(db, record.user_id, payload.new_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset token is invalid or expired")
    consume_password_reset_token(db, record)
    return PasswordResetConfirmResponse(status="ok", message="Password updated. Sign in with your new password.")


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> AuthUser:
    token = credentials.credentials if credentials else request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            issuer=settings.jwt_issuer,
        )
    except JWTError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from error

    user_id = claims.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    user = get_auth_user(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")
    return user


def get_user_from_token(db: Session, token: str) -> AuthUser | None:
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM], issuer=settings.jwt_issuer)
    except JWTError:
        return None
    user_id = claims.get("sub")
    return get_auth_user(db, user_id) if isinstance(user_id, str) else None


def membership_role(user: AuthUser, tenant_id: str) -> str | None:
    if user.role == "Admin":
        return "Admin"
    for membership in user.memberships:
        if membership.tenant_id == tenant_id:
            return membership.role
    return None


def require_tenant_access(user: AuthUser, tenant_id: str, allowed_roles: set[str] | None = None) -> str:
    role = membership_role(user, tenant_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not a member of this tenant")
    if allowed_roles is not None and role not in allowed_roles and user.role != "Admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Role cannot perform this action")
    return role
