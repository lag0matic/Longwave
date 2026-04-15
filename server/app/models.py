from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def utc_now() -> datetime:
    return datetime.now(UTC)


class Logbook(ApiModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    operator_callsign: str
    park_reference: str | None = None
    activation_date: str | None = None
    notes: str | None = None
    contact_count: int = 0
    updated_at: datetime = Field(default_factory=utc_now)


class Contact(ApiModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    logbook_id: str
    station_callsign: str
    operator_callsign: str
    qso_date: str
    time_on: str
    band: str
    mode: str
    frequency_khz: float
    park_reference: str | None = None
    rst_sent: str | None = None
    rst_recvd: str | None = None
    tx_power: str | None = None
    name: str | None = None
    qth: str | None = None
    county: str | None = None
    grid_square: str | None = None
    country: str | None = None
    state: str | None = None
    dxcc: str | None = None
    qrz_upload_status: str | None = None
    qrz_upload_date: str | None = None
    lat: float | None = None
    lon: float | None = None
    source_spot_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Spot(ApiModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    source: Literal["pota"] = "pota"
    activator_callsign: str
    park_reference: str
    frequency_khz: float
    mode: str
    band: str
    comments: str | None = None
    spotter_callsign: str | None = None
    spotted_at: datetime = Field(default_factory=utc_now)
    lat: float | None = None
    lon: float | None = None


class SyncEvent(ApiModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    entity_type: Literal["contact", "logbook", "spot"]
    entity_id: str
    action: Literal["create", "update", "delete"]
    payload: dict
    client_timestamp: datetime = Field(default_factory=utc_now)
