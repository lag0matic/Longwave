from pydantic import BaseModel, Field

from .models import Contact, Logbook, Spot, SyncEvent


class CallsignLookupResult(BaseModel):
    callsign: str
    name: str | None = None
    qth: str | None = None
    county: str | None = None
    grid_square: str | None = None
    country: str | None = None
    state: str | None = None
    dxcc: str | None = None
    lat: float | None = None
    lon: float | None = None
    qrz_url: str | None = None


class SpotCreateRequest(BaseModel):
    activator_callsign: str
    park_reference: str
    frequency_khz: float
    mode: str
    band: str
    comments: str | None = None
    spotter_callsign: str | None = None


class UserContextResponse(BaseModel):
    id: str
    username: str
    callsign: str


class AppSettingsResponse(BaseModel):
    station_callsign: str
    station_name: str
    my_grid_square: str | None = None
    my_state: str | None = None
    my_county: str | None = None
    default_tx_power: str | None = None
    api_token_enabled: bool
    admin_access: bool = True
    qrz_username: str | None = None
    qrz_configured: bool
    pota_configured: bool


class AppSettingsUpdateRequest(BaseModel):
    station_callsign: str | None = None
    station_name: str | None = None
    my_grid_square: str | None = None
    my_state: str | None = None
    my_county: str | None = None
    default_tx_power: str | None = None
    qrz_username: str | None = None
    qrz_password: str | None = None
    qrz_api_key: str | None = None
    pota_api_key: str | None = None
    api_token_enabled: bool | None = None


class ApiTokenRotateResponse(BaseModel):
    api_token: str


class TokenBundleResponse(BaseModel):
    client_api_token: str
    admin_api_token: str


class LogbookCreateRequest(BaseModel):
    name: str
    operator_callsign: str
    park_reference: str | None = None
    activation_date: str | None = None
    notes: str | None = None


class LogbookUpdateRequest(BaseModel):
    name: str | None = None
    operator_callsign: str | None = None
    park_reference: str | None = None
    activation_date: str | None = None
    notes: str | None = None


class ContactCreateRequest(BaseModel):
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


class ContactUpdateRequest(BaseModel):
    station_callsign: str | None = None
    operator_callsign: str | None = None
    qso_date: str | None = None
    time_on: str | None = None
    band: str | None = None
    mode: str | None = None
    frequency_khz: float | None = None
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


class SyncRequest(BaseModel):
    events: list[SyncEvent] = Field(default_factory=list)


class SyncResponse(BaseModel):
    accepted_event_ids: list[str]
    contacts: list[Contact]
    logbooks: list[Logbook]
    spots: list[Spot]


class HealthResponse(BaseModel):
    status: str
    database: str


class AdifImportResponse(BaseModel):
    imported_contacts: list[Contact]
    adif_version: str = "3.1.4"


class QrzUploadRequest(BaseModel):
    logbook_id: str


class QrzUploadResponse(BaseModel):
    logbook_id: str
    uploaded: bool
    message: str
