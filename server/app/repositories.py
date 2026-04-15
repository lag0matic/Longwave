from sqlalchemy import func, select
from sqlalchemy.orm import Session
from secrets import token_urlsafe

from . import models
from .db_models import AppSettingsRecord, ContactRecord, LogbookRecord, SyncEventRecord, UserRecord

DEFAULT_USERNAME = "local-operator"
DEFAULT_CALLSIGN = "N0CALL"
DEFAULT_STATION_NAME = "Local Operator"


def ensure_app_settings(db: Session) -> AppSettingsRecord:
    settings = db.get(AppSettingsRecord, 1)
    if settings is None:
        shared_token = token_urlsafe(24)
        settings = AppSettingsRecord(
            id=1,
            station_callsign=DEFAULT_CALLSIGN,
            station_name=DEFAULT_STATION_NAME,
            default_tx_power="100",
            api_token=shared_token,
            client_api_token=shared_token,
            admin_api_token=shared_token,
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    else:
        changed = False
        if not settings.client_api_token:
            settings.client_api_token = settings.api_token
            changed = True
        if not settings.admin_api_token:
            settings.admin_api_token = settings.api_token
            changed = True
        if changed:
            db.commit()
            db.refresh(settings)
    return settings


def ensure_local_operator(db: Session) -> UserRecord:
    settings = ensure_app_settings(db)
    user = db.scalar(select(UserRecord).where(UserRecord.username == DEFAULT_USERNAME))
    if user is None:
        user = UserRecord(username=DEFAULT_USERNAME, callsign=settings.station_callsign)
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.callsign != settings.station_callsign:
        user.callsign = settings.station_callsign
        db.commit()
        db.refresh(user)
    return user


def seed_demo_data(db: Session) -> None:
    settings = ensure_app_settings(db)
    user = ensure_local_operator(db)
    existing = db.scalar(select(func.count()).select_from(LogbookRecord).where(LogbookRecord.user_id == user.id))
    if existing and existing > 0:
        return

    activation = LogbookRecord(
        user_id=user.id,
        name="Brown County SP Activation",
        operator_callsign=settings.station_callsign,
        park_reference="US-1576",
        activation_date="20260414",
        notes="Starter activation logbook",
    )
    hunting = LogbookRecord(
        user_id=user.id,
        name="General Hunting Log",
        operator_callsign=settings.station_callsign,
        notes="Cross-park hunting contacts",
    )
    db.add_all([activation, hunting])
    db.flush()

    db.add_all(
        [
            ContactRecord(
                logbook_id=activation.id,
                station_callsign="K8LW",
                operator_callsign=settings.station_callsign,
                qso_date="20260414",
                time_on="1512",
                band="20m",
                mode="SSB",
                frequency_khz=14286.0,
                park_reference="US-1234",
                grid_square="EM79",
                country="United States",
                state="IN",
                lat=39.76,
                lon=-86.15,
            ),
            ContactRecord(
                logbook_id=hunting.id,
                station_callsign="VE3ABC",
                operator_callsign=settings.station_callsign,
                qso_date="20260413",
                time_on="1830",
                band="20m",
                mode="CW",
                frequency_khz=14058.0,
                grid_square="FN03",
                country="Canada",
                lat=43.65,
                lon=-79.38,
            ),
        ]
    )
    db.commit()


def to_logbook_model(record: LogbookRecord, contact_count: int) -> models.Logbook:
    return models.Logbook.model_validate(
        {
            "id": record.id,
            "name": record.name,
            "operator_callsign": record.operator_callsign,
            "park_reference": record.park_reference,
            "activation_date": record.activation_date,
            "notes": record.notes,
            "contact_count": contact_count,
            "updated_at": record.updated_at,
        }
    )


def to_contact_model(record: ContactRecord) -> models.Contact:
    return models.Contact.model_validate(record, from_attributes=True)


def to_sync_event_model(record: SyncEventRecord) -> models.SyncEvent:
    return models.SyncEvent.model_validate(record, from_attributes=True)
