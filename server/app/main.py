from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import inspect
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .api.routes import router
from .config import get_settings
from .db import SessionLocal, engine
from .repositories import seed_demo_data

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url=f"{settings.api_prefix}/openapi.json" if settings.enable_docs else None,
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.parsed_allowed_hosts(),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.parsed_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix=settings.api_prefix)


@app.middleware("http")
async def add_security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    if settings.environment.lower() == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.on_event("startup")
def initialize_database() -> None:
    if not settings.seed_demo_data:
        return

    inspector = inspect(engine)
    required_tables = {"app_settings", "users", "logbooks", "contacts", "sync_events"}
    if required_tables.issubset(set(inspector.get_table_names())):
        with SessionLocal() as session:
            seed_demo_data(session)
