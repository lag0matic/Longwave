import secrets
import threading
import time
from collections import deque

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_db
from .db_models import AppSettingsRecord, UserRecord
from .repositories import ensure_app_settings, ensure_local_operator

_auth_failures: dict[str, deque[float]] = {}
_auth_lock = threading.Lock()


def _client_identity(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown-client"


def _prune_failures(identity: str, window_seconds: int) -> deque[float]:
    bucket = _auth_failures.setdefault(identity, deque())
    cutoff = time.monotonic() - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    return bucket


def _check_rate_limit(identity: str, settings: Settings) -> None:
    with _auth_lock:
        bucket = _prune_failures(identity, settings.auth_rate_limit_window_seconds)
        if len(bucket) >= settings.auth_rate_limit_max_failures:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed authentication attempts. Try again later.",
            )


def _record_auth_failure(identity: str, settings: Settings) -> None:
    with _auth_lock:
        bucket = _prune_failures(identity, settings.auth_rate_limit_window_seconds)
        bucket.append(time.monotonic())


def _clear_auth_failures(identity: str) -> None:
    with _auth_lock:
        _auth_failures.pop(identity, None)


def get_app_settings(db: Session = Depends(get_db)) -> AppSettingsRecord:
    return ensure_app_settings(db)


def _expected_token(app_settings: AppSettingsRecord, token_kind: str) -> str:
    if token_kind == "admin":
        return app_settings.admin_api_token or app_settings.api_token or ""
    return app_settings.client_api_token or app_settings.api_token or ""


def validate_token(
    *,
    app_settings: AppSettingsRecord,
    provided_token: str | None,
    identity: str,
    settings: Settings,
    token_kind: str = "client",
) -> None:
    if not app_settings.api_token_enabled:
        return

    _check_rate_limit(identity, settings)

    expected = _expected_token(app_settings, token_kind)
    candidate = provided_token or ""
    if not candidate or not secrets.compare_digest(candidate, expected):
        _record_auth_failure(identity, settings)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid {token_kind} API token.")

    _clear_auth_failures(identity)


def validate_api_token(
    *,
    app_settings: AppSettingsRecord,
    provided_token: str | None,
    identity: str,
    settings: Settings,
) -> None:
    validate_token(
        app_settings=app_settings,
        provided_token=provided_token,
        identity=identity,
        settings=settings,
        token_kind="client",
    )


def require_api_token(
    request: Request,
    app_settings: AppSettingsRecord = Depends(get_app_settings),
    settings: Settings = Depends(get_settings),
    x_api_key: str | None = Header(default=None),
) -> None:
    validate_api_token(
        app_settings=app_settings,
        provided_token=x_api_key,
        identity=_client_identity(request),
        settings=settings,
    )


def require_admin_api_token(
    request: Request,
    app_settings: AppSettingsRecord = Depends(get_app_settings),
    settings: Settings = Depends(get_settings),
    x_admin_api_key: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> None:
    validate_token(
        app_settings=app_settings,
        provided_token=x_admin_api_key or x_api_key,
        identity=_client_identity(request),
        settings=settings,
        token_kind="admin",
    )


def get_current_operator(
    db: Session = Depends(get_db),
) -> UserRecord:
    return ensure_local_operator(db)
