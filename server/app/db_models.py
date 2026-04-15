from datetime import UTC, datetime
from uuid import uuid4

from secrets import token_urlsafe

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class UserRecord(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    callsign: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    logbooks: Mapped[list["LogbookRecord"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sync_events: Mapped[list["SyncEventRecord"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class AppSettingsRecord(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    station_callsign: Mapped[str] = mapped_column(String(32), default="N0CALL")
    station_name: Mapped[str] = mapped_column(String(100), default="Local Operator")
    my_grid_square: Mapped[str | None] = mapped_column(String(16), nullable=True)
    my_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    my_county: Mapped[str | None] = mapped_column(String(128), nullable=True)
    default_tx_power: Mapped[str | None] = mapped_column(String(16), nullable=True)
    qrz_username: Mapped[str | None] = mapped_column(String(100), nullable=True)
    qrz_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    qrz_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pota_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    api_token: Mapped[str] = mapped_column(String(255), default=lambda: token_urlsafe(24))
    client_api_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    admin_api_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    api_token_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class LogbookRecord(Base):
    __tablename__ = "logbooks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    operator_callsign: Mapped[str] = mapped_column(String(32), index=True)
    park_reference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    activation_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    user: Mapped[UserRecord] = relationship(back_populates="logbooks")
    contacts: Mapped[list["ContactRecord"]] = relationship(back_populates="logbook", cascade="all, delete-orphan")


class ContactRecord(Base):
    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    logbook_id: Mapped[str] = mapped_column(ForeignKey("logbooks.id"), index=True)
    station_callsign: Mapped[str] = mapped_column(String(32), index=True)
    operator_callsign: Mapped[str] = mapped_column(String(32), index=True)
    qso_date: Mapped[str] = mapped_column(String(16), index=True)
    time_on: Mapped[str] = mapped_column(String(16))
    band: Mapped[str] = mapped_column(String(16))
    mode: Mapped[str] = mapped_column(String(16))
    frequency_khz: Mapped[float] = mapped_column(Float)
    park_reference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    rst_sent: Mapped[str | None] = mapped_column(String(8), nullable=True)
    rst_recvd: Mapped[str | None] = mapped_column(String(8), nullable=True)
    tx_power: Mapped[str | None] = mapped_column(String(16), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    qth: Mapped[str | None] = mapped_column(String(128), nullable=True)
    county: Mapped[str | None] = mapped_column(String(128), nullable=True)
    grid_square: Mapped[str | None] = mapped_column(String(16), nullable=True)
    country: Mapped[str | None] = mapped_column(String(128), nullable=True)
    state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dxcc: Mapped[str | None] = mapped_column(String(16), nullable=True)
    qrz_upload_status: Mapped[str | None] = mapped_column(String(8), nullable=True)
    qrz_upload_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_spot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    logbook: Mapped[LogbookRecord] = relationship(back_populates="contacts")


class SyncEventRecord(Base):
    __tablename__ = "sync_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict] = mapped_column(JSON)
    client_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[UserRecord] = relationship(back_populates="sync_events")
