from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile

from ..config import Settings, get_settings
from ..db import get_db
from ..db_models import AppSettingsRecord, ContactRecord, LogbookRecord, SyncEventRecord, UserRecord
from ..dependencies import (
    get_app_settings,
    get_current_operator,
    require_api_token,
    require_admin_api_token,
    validate_api_token,
    validate_token,
)
from ..models import Contact, Logbook, Spot
from ..repositories import (
    ensure_app_settings,
    to_contact_model,
    to_logbook_model,
)
from ..schemas import (
    AdifImportResponse,
    ApiTokenRotateResponse,
    AppSettingsResponse,
    AppSettingsUpdateRequest,
    CallsignLookupResult,
    ContactCreateRequest,
    ContactUpdateRequest,
    HealthResponse,
    LogbookCreateRequest,
    LogbookUpdateRequest,
    QrzUploadRequest,
    QrzUploadResponse,
    SpotCreateRequest,
    SyncRequest,
    SyncResponse,
    TokenBundleResponse,
    UserContextResponse,
)
from ..services.adif import export_contacts_to_adif, import_adif_text
from ..services.pota import PotaService
from ..services.qrz import QrzService

router = APIRouter()

SPOTS: list[Spot] = []


def build_settings_response(app_settings: AppSettingsRecord, *, admin_access: bool = True) -> AppSettingsResponse:
    return AppSettingsResponse(
        station_callsign=app_settings.station_callsign,
        station_name=app_settings.station_name,
        my_grid_square=app_settings.my_grid_square,
        my_state=app_settings.my_state,
        my_county=app_settings.my_county,
        default_tx_power=app_settings.default_tx_power,
        api_token_enabled=app_settings.api_token_enabled,
        admin_access=admin_access,
        qrz_username=app_settings.qrz_username,
        qrz_configured=bool(app_settings.qrz_username and (app_settings.qrz_password or app_settings.qrz_api_key)),
        pota_configured=bool(app_settings.pota_api_key),
    )


@router.get("/health", response_model=HealthResponse)
async def health(
    request: Request,
    settings: Settings = Depends(get_settings),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> HealthResponse:
    if not settings.public_healthcheck:
        identity = request.client.host if request.client and request.client.host else "unknown-client"
        candidate = request.headers.get("X-Api-Key") or request.headers.get("X-Admin-Api-Key")
        try:
            validate_token(
                app_settings=app_settings,
                provided_token=candidate,
                identity=identity,
                settings=settings,
                token_kind="client",
            )
        except HTTPException:
            validate_token(
                app_settings=app_settings,
                provided_token=candidate,
                identity=identity,
                settings=settings,
                token_kind="admin",
            )
    database = "sqlite" if settings.database_url.startswith("sqlite") else "postgresql"
    return HealthResponse(status="ok", database=database)


@router.get("/me", response_model=UserContextResponse)
async def get_me(
    _: None = Depends(require_api_token),
    current_user: UserRecord = Depends(get_current_operator),
) -> UserContextResponse:
    return UserContextResponse(id=current_user.id, username=current_user.username, callsign=current_user.callsign)


@router.get("/settings", response_model=AppSettingsResponse)
async def get_settings_summary(
    _: None = Depends(require_admin_api_token),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> AppSettingsResponse:
    return build_settings_response(app_settings)


@router.patch("/settings", response_model=AppSettingsResponse)
async def update_settings_summary(
    request: AppSettingsUpdateRequest,
    _: None = Depends(require_admin_api_token),
    db: Session = Depends(get_db),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
    current_user: UserRecord = Depends(get_current_operator),
) -> AppSettingsResponse:
    for key, value in request.model_dump(exclude_unset=True).items():
        setattr(app_settings, key, value)

    if request.station_callsign is not None:
        current_user.callsign = request.station_callsign

        owned_logbooks = db.scalars(select(LogbookRecord).where(LogbookRecord.user_id == current_user.id)).all()
        for logbook in owned_logbooks:
            logbook.operator_callsign = request.station_callsign

    db.commit()
    db.refresh(app_settings)
    db.refresh(current_user)

    return build_settings_response(app_settings)


@router.post("/settings/rotate-client-token", response_model=ApiTokenRotateResponse)
async def rotate_client_api_token(
    _: None = Depends(require_admin_api_token),
    db: Session = Depends(get_db),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> ApiTokenRotateResponse:
    from secrets import token_urlsafe

    app_settings.client_api_token = token_urlsafe(24)
    db.commit()
    db.refresh(app_settings)
    return ApiTokenRotateResponse(api_token=app_settings.client_api_token or "")


@router.post("/settings/rotate-admin-token", response_model=ApiTokenRotateResponse)
async def rotate_admin_api_token(
    _: None = Depends(require_admin_api_token),
    db: Session = Depends(get_db),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> ApiTokenRotateResponse:
    from secrets import token_urlsafe

    app_settings.admin_api_token = token_urlsafe(24)
    db.commit()
    db.refresh(app_settings)
    return ApiTokenRotateResponse(api_token=app_settings.admin_api_token or "")


@router.post("/settings/rotate-token", response_model=ApiTokenRotateResponse)
async def rotate_api_token(
    _: None = Depends(require_admin_api_token),
    db: Session = Depends(get_db),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> ApiTokenRotateResponse:
    from secrets import token_urlsafe

    app_settings.client_api_token = token_urlsafe(24)
    db.commit()
    db.refresh(app_settings)
    return ApiTokenRotateResponse(api_token=app_settings.client_api_token or "")


@router.get("/settings/tokens", response_model=TokenBundleResponse)
async def get_tokens(
    _: None = Depends(require_admin_api_token),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> TokenBundleResponse:
    return TokenBundleResponse(
        client_api_token=app_settings.client_api_token or app_settings.api_token,
        admin_api_token=app_settings.admin_api_token or app_settings.api_token,
    )


@router.get("/logbooks", response_model=list[Logbook])
async def list_logbooks(
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> list[Logbook]:
    records = db.scalars(
        select(LogbookRecord)
        .where(LogbookRecord.user_id == current_user.id)
        .order_by(LogbookRecord.updated_at.desc())
    ).all()

    logbook_ids = [record.id for record in records]
    counts_by_logbook: dict[str, int] = {}
    if logbook_ids:
        count_rows = db.execute(
            select(ContactRecord.logbook_id, func.count(ContactRecord.id))
            .where(ContactRecord.logbook_id.in_(logbook_ids))
            .group_by(ContactRecord.logbook_id)
        ).all()
        counts_by_logbook = {logbook_id: count for logbook_id, count in count_rows}

    return [to_logbook_model(record, counts_by_logbook.get(record.id, 0)) for record in records]


@router.post("/logbooks", response_model=Logbook, status_code=201)
async def create_logbook(
    request: LogbookCreateRequest,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> Logbook:
    record = LogbookRecord(user_id=current_user.id, **request.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return to_logbook_model(record, 0)


@router.patch("/logbooks/{logbook_id}", response_model=Logbook)
async def update_logbook(
    logbook_id: str,
    request: LogbookUpdateRequest,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> Logbook:
    record = db.scalar(
        select(LogbookRecord).where(LogbookRecord.id == logbook_id, LogbookRecord.user_id == current_user.id)
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Logbook not found.")

    for key, value in request.model_dump(exclude_unset=True).items():
        setattr(record, key, value)

    db.commit()
    db.refresh(record)
    contact_count = db.scalar(
        select(func.count()).select_from(ContactRecord).where(ContactRecord.logbook_id == record.id)
    ) or 0
    return to_logbook_model(record, contact_count)


@router.delete("/logbooks/{logbook_id}", status_code=204)
async def delete_logbook(
    logbook_id: str,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> Response:
    record = db.scalar(
        select(LogbookRecord).where(LogbookRecord.id == logbook_id, LogbookRecord.user_id == current_user.id)
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Logbook not found.")

    db.delete(record)
    db.commit()
    return Response(status_code=204)


@router.get("/contacts", response_model=list[Contact])
async def list_contacts(
    logbook_id: str | None = None,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> list[Contact]:
    query = (
        select(ContactRecord)
        .join(LogbookRecord, ContactRecord.logbook_id == LogbookRecord.id)
        .where(LogbookRecord.user_id == current_user.id)
        .order_by(ContactRecord.qso_date.desc(), ContactRecord.time_on.desc())
    )
    if logbook_id:
        query = query.where(ContactRecord.logbook_id == logbook_id)
    records = db.scalars(query).all()
    return [to_contact_model(record) for record in records]


@router.post("/contacts", response_model=Contact, status_code=201)
async def create_contact(
    request: ContactCreateRequest,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> Contact:
    logbook = db.scalar(
        select(LogbookRecord).where(
            LogbookRecord.id == request.logbook_id,
            LogbookRecord.user_id == current_user.id,
        )
    )
    if logbook is None:
        raise HTTPException(status_code=404, detail="Logbook not found.")

    record = ContactRecord(**request.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return to_contact_model(record)


@router.patch("/contacts/{contact_id}", response_model=Contact)
async def update_contact(
    contact_id: str,
    request: ContactUpdateRequest,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> Contact:
    record = db.scalar(
        select(ContactRecord)
        .join(LogbookRecord, ContactRecord.logbook_id == LogbookRecord.id)
        .where(ContactRecord.id == contact_id, LogbookRecord.user_id == current_user.id)
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Contact not found.")

    for key, value in request.model_dump(exclude_unset=True).items():
        setattr(record, key, value)

    db.commit()
    db.refresh(record)
    return to_contact_model(record)


@router.delete("/contacts/{contact_id}", status_code=204)
async def delete_contact(
    contact_id: str,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> Response:
    record = db.scalar(
        select(ContactRecord)
        .join(LogbookRecord, ContactRecord.logbook_id == LogbookRecord.id)
        .where(ContactRecord.id == contact_id, LogbookRecord.user_id == current_user.id)
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Contact not found.")

    db.delete(record)
    db.commit()
    return Response(status_code=204)


@router.get("/spots/pota", response_model=list[Spot])
async def get_pota_spots(
    settings: Settings = Depends(get_settings),
    _: None = Depends(require_api_token),
) -> list[Spot]:
    service = PotaService(settings)
    fetched = await service.fetch_spots()
    SPOTS[:] = fetched
    return SPOTS


@router.post("/spots/pota", response_model=Spot)
async def create_pota_spot(
    request: SpotCreateRequest,
    settings: Settings = Depends(get_settings),
    _: None = Depends(require_api_token),
) -> Spot:
    service = PotaService(settings)
    spot = await service.create_spot(request)
    SPOTS.insert(0, spot)
    return spot


@router.get("/lookups/qrz/{callsign}", response_model=CallsignLookupResult)
async def lookup_callsign(
    callsign: str,
    settings: Settings = Depends(get_settings),
    _: None = Depends(require_api_token),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> CallsignLookupResult:
    service = QrzService(
        settings,
        username=app_settings.qrz_username,
        password=app_settings.qrz_password,
        api_key=app_settings.qrz_api_key,
    )
    try:
        return await service.lookup_callsign(callsign)
    except RuntimeError as error:
        detail = str(error)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail) from error


@router.post("/logs/import", response_model=AdifImportResponse)
async def import_adif(
    logbook_id: str,
    operator_callsign: str,
    file: UploadFile = File(...),
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> AdifImportResponse:
    adif_text = (await file.read()).decode("utf-8", errors="ignore")
    imported_contacts = import_adif_text(adif_text, logbook_id, operator_callsign)
    logbook = db.scalar(
        select(LogbookRecord).where(LogbookRecord.id == logbook_id, LogbookRecord.user_id == current_user.id)
    )
    if logbook is None:
        raise HTTPException(status_code=404, detail="Logbook not found.")

    persisted: list[Contact] = []
    for contact in imported_contacts:
        record = ContactRecord(**contact.model_dump())
        db.add(record)
        persisted.append(contact)
    db.commit()
    return AdifImportResponse(imported_contacts=imported_contacts)


@router.get("/logs/{logbook_id}/adif")
async def export_adif(
    logbook_id: str,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> dict[str, str]:
    logbook = db.scalar(
        select(LogbookRecord).where(LogbookRecord.id == logbook_id, LogbookRecord.user_id == current_user.id)
    )
    if logbook is None:
        raise HTTPException(status_code=404, detail="Logbook not found.")

    records = db.scalars(select(ContactRecord).where(ContactRecord.logbook_id == logbook_id)).all()
    contacts = [to_contact_model(record) for record in records]
    if not contacts:
        raise HTTPException(status_code=404, detail="No contacts found for logbook.")
    return {"adif": export_contacts_to_adif(contacts, to_logbook_model(logbook, len(contacts)), app_settings)}


@router.post("/logs/qrz-upload", response_model=QrzUploadResponse)
async def qrz_upload(
    request: QrzUploadRequest,
    settings: Settings = Depends(get_settings),
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
    app_settings: AppSettingsRecord = Depends(get_app_settings),
) -> QrzUploadResponse:
    logbook = db.scalar(
        select(LogbookRecord).where(
            LogbookRecord.id == request.logbook_id,
            LogbookRecord.user_id == current_user.id,
        )
    )
    if logbook is None:
        raise HTTPException(status_code=404, detail="Logbook not found.")

    records = db.scalars(select(ContactRecord).where(ContactRecord.logbook_id == request.logbook_id)).all()
    contacts = [to_contact_model(record) for record in records]
    if not contacts:
        raise HTTPException(status_code=404, detail="Logbook has no contacts.")
    service = QrzService(
        settings,
        username=app_settings.qrz_username,
        password=app_settings.qrz_password,
        api_key=app_settings.qrz_api_key,
    )
    adif_text = export_contacts_to_adif(contacts, to_logbook_model(logbook, len(contacts)), app_settings)
    result = await service.upload_adif(request.logbook_id, adif_text)
    if result.uploaded:
        upload_date = datetime.now(UTC).strftime("%Y%m%d")
        for record in records:
            record.qrz_upload_status = "Y"
            record.qrz_upload_date = upload_date
        db.commit()
    return result


@router.post("/sync", response_model=SyncResponse)
async def sync(
    request: SyncRequest,
    _: None = Depends(require_api_token),
    db: Session = Depends(get_db),
    current_user: UserRecord = Depends(get_current_operator),
) -> SyncResponse:
    accepted_event_ids: list[str] = []
    for event in request.events:
        existing = db.get(SyncEventRecord, event.id)
        if existing is None:
            db.add(SyncEventRecord(user_id=current_user.id, **event.model_dump()))
        accepted_event_ids.append(event.id)
    db.commit()

    logbooks = await list_logbooks(db=db, current_user=current_user, _=None)
    contacts = await list_contacts(db=db, current_user=current_user, _=None)
    return SyncResponse(
        accepted_event_ids=accepted_event_ids,
        contacts=contacts,
        logbooks=logbooks,
        spots=SPOTS,
    )
