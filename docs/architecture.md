# Longwave Architecture

## Product goals

Longwave is meant to support both activation logging and park hunting from a single system:

- log QSOs in ADIF-compatible format
- manage multiple logbooks, especially for separate POTA activations
- look up callsigns with QRZ
- upload logs to QRZ
- browse POTA spots, pick a spot, and pre-fill a contact
- tune an FLrig-compatible radio server from supported desktop clients to a selected spot
- create self-spots or spot other activators on POTA
- keep logs cloud-backed while allowing offline operation and later sync
- visualize worked stations on a contact map

## High-level design

### Client

The client is a React application delivered primarily through a Tauri desktop shell on Windows and Linux. It has these responsibilities:

- local logbook and draft-contact editing
- spot browsing and selection
- offline mutation queueing
- sync status display and retry
- contact map rendering
- direct FLrig-compatible control commands initiated by the operator from supported desktop devices
- mobile-focused logging, spotting, and sync workflows without rig control

The client should treat local state as authoritative while offline and reconcile with the server when connectivity returns.

### Server

The FastAPI server is responsible for:

- account and credential management
- canonical cloud log storage
- QRZ and POTA integration calls
- ADIF import/export normalization
- sync event ingestion and conflict detection
- no direct rig-control responsibility; the server exists to retain and synchronize logs across devices

Current implementation note:

- the server owns a single local operator profile
- client devices authenticate with a shared API token to sync against that operator's server
- station identity and QRZ/POTA configuration are stored in local app settings
- production startup is environment-driven, migrations run before launch, demo seed data is opt-in, and CORS is restricted through configuration rather than wide-open by default

## Domain model

### Logbook

- one operator profile can own multiple logbooks
- POTA activations typically map 1:1 with a logbook
- a logbook stores metadata like park reference, activation date, operator callsign, and station notes

### Contact

- contacts are stored as QSO records shaped around ADIF
- enriched fields can include QRZ-derived grid, state, DXCC, and lat/lon
- contacts can optionally reference a spot they originated from

### Spot

- normalized wrapper for POTA spot payloads
- includes callsign, park reference, frequency, mode, comments, spotter, and timestamps
- can be promoted into a draft contact

### SyncEvent

- every offline mutation is stored as a sync event on the client
- the server acknowledges applied events and returns canonical records
- conflict policy should prefer field-level merges when safe and explicit user review when not

## Integration boundaries

### QRZ

- `LookupService.lookup_callsign()` resolves callsign metadata
- `QRZUploadService.upload_adif()` sends completed logs upstream
- credentials should be stored server-side, with short-lived client auth tokens for user sessions

### POTA

- `PotaService.fetch_spots()` pulls current spots
- `PotaService.create_spot()` submits self-spots or third-party spots
- client-side filtering should support band, mode, park, and distance

### FLrig

- the Tauri desktop client talks directly to an FLrig-compatible XML-RPC endpoint on the operator's local network or machine
- this stays client-side because rig control is device-local and should not route through cloud infrastructure
- Windows and Linux are the intended FLrig-capable platforms
- Linux can connect to native FLrig, while Windows can connect to ShackStack when it presents an FLrig-compatible endpoint
- mobile clients should omit rig-control actions and focus on logging, contact editing, spotting, and sync
- rig commands should be explicitly user-initiated, never automatic in the background

## Storage plan

### Server

- PostgreSQL for users, logbooks, contacts, credentials, and sync events
- object storage for ADIF exports/backups if needed
- local development can use SQLite, but deployment should target PostgreSQL
- schema upgrades should be applied with Alembic before starting the app

### Client

- IndexedDB for logbooks, contacts, cached spots, and pending sync events
- service worker cache for shell assets and recent API payloads

## Suggested roadmap

1. Replace in-memory stores with PostgreSQL and Alembic.
2. Add a first-run client setup flow and encrypt local integration settings at rest.
3. Add IndexedDB repository layer and background sync.
4. Add full ADIF parser coverage and import validation.
5. Add richer desktop rig-state inspection, connection testing, and endpoint presets for FLrig/ShackStack.
6. Add responsive/mobile capability gating so rig-control UI is hidden where unsupported.
7. Add tests around sync conflict handling and rig commands.
