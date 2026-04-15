# Longwave

Longwave is a cloud-synced ham radio logging platform for POTA operators and hunters. This repository is scaffolded as a split server/client application:

- `server/` is a FastAPI service for cloud log retention, sync, ADIF handling, and centralized integrations like QRZ and POTA.
- `client/` is now a React + TypeScript desktop-first client with a Tauri shell for Windows and Linux, plus a browser preview for UI development.
- `docs/` captures the architecture and domain model so the project can grow cleanly.

## Why this stack

- Tauri gives us a real desktop application for Windows and Linux while still letting the UI stay in React.
- Native desktop packaging is a better fit for FLrig-compatible local control than a browser-only app.
- The same rig-control surface can target Linux FLrig and Windows ShackStack as long as both present a compatible FLrig XML-RPC endpoint.
- FastAPI is a strong fit for ADIF workflows, XML/API interop, and structured sync endpoints.
- The project is organized around explicit domain objects like `Logbook`, `Contact`, `Spot`, and `SyncEvent`.

## Current state

This initial scaffold includes:

- server API routes with database-backed logbook/contact CRUD, sync, single-operator profile handling, settings management, token rotation, and integration service stubs
- ADIF export/import helpers
- client screens for logbooks, POTA hunting, draft contact capture, sync status, contact map visualization, offline queueing, and server-backed contact/spot actions
- a Tauri desktop shell with a native FLrig-compatible XML-RPC bridge for Windows and Linux
- an offline queue model on the client

## Quick start

### Server

1. Create `server/.venv`.
2. Install dependencies from `server/requirements.txt`.
3. Copy `server/.env.example` to `server/.env`.
4. Set at least `DATABASE_URL`, `HOST`, `PORT`, and `CORS_ORIGINS`.
5. Start with:
   - Windows GUI host: `python .\windows_host.py`
   - Windows console host: `.\start-longwave.ps1`
   - Linux: `./start-longwave.sh`

The Windows GUI host gives you a small status window with server health and the API token. The startup scripts apply `alembic upgrade head` before starting Uvicorn.

For local testing, SQLite is still fine.
For a deployed server on another machine, PostgreSQL is the better target, for example:

`postgresql+psycopg://longwave:password@server-host/longwave`

This server is now modeled as a self-hosted single-operator service. Clients authenticate with an API token using:

- `X-Api-Key`: client sync token

The token is generated and stored in the local database settings record on first startup.
Demo seed data is now disabled by default and only appears when `SEED_DEMO_DATA=true`.

Current management endpoints include:

- `GET /api/v1/settings`
- `PATCH /api/v1/settings`
- `POST /api/v1/settings/rotate-token`

Settings currently support station identity plus locally stored QRZ/POTA configuration.

There is now a server-specific deployment guide in [server/README.md](C:/Users/lag0m/Documents/Longwave/server/README.md), plus:

- a Linux `systemd` starter unit at [server/deploy/longwave.service](C:/Users/lag0m/Documents/Longwave/server/deploy/longwave.service)
- a Docker path via [server/Dockerfile](C:/Users/lag0m/Documents/Longwave/server/Dockerfile)

### Client

1. Run `npm install` inside `client/`.
2. Run `npm run dev` for browser UI preview.
3. Run `npm run tauri:dev` for the desktop app.

The desktop client stores the FLrig/ShackStack endpoint locally on each workstation. For example:

- `http://127.0.0.1:12345`
- `http://127.0.0.1:12345/RPC2`

### Linux desktop install

For Arch/CachyOS, install the Tauri/Linux prerequisites first:

```bash
sudo pacman -Syu
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg \
  xdotool \
  nodejs \
  npm \
  rustup
rustup default stable
```

Then build the desktop app:

```bash
git clone https://github.com/lag0matic/Longwave.git
cd Longwave/client
npm install
npm run tauri:build
```

The first Linux target to use is the generated AppImage under `client/src-tauri/target/release/bundle/appimage/`.

### Self-signed certificate workflow

Longwave currently supports a self-signed HTTPS server well enough for personal remote use. The current workflow is:

1. Generate a self-signed server certificate on the Windows server for your public hostname.
2. Configure `SSL_CERTFILE`, `SSL_KEYFILE`, and `ALLOWED_HOSTS` in `%LOCALAPPDATA%\\LongwaveServer\\.env`.
3. Use `https://your-hostname/api/v1` in the desktop client.

For Linux desktop trust, copy the server certificate file to your Linux machine and install it into the local trust store:

```bash
sudo cp fullchain.pem /etc/ca-certificates/trust-source/anchors/longwave-server.crt
sudo update-ca-trust
```

After that, the Tauri desktop client should trust the self-signed Longwave server certificate through the OS trust store.

## Next build steps

1. Add persistent storage with PostgreSQL on the server and IndexedDB on the client.
2. Implement real QRZ session management and authenticated upload flows.
3. Connect live POTA APIs and normalize spot data.
4. Add a first-run setup workflow in the client for station identity, API token pairing, and QRZ/POTA configuration.
5. Add FLrig/ShackStack connection presets, validation, and richer rig-state feedback in the desktop client.
6. Add a mobile-first logging mode that hides rig-control affordances cleanly when we return to mobile.
7. Add a real basemap provider or vector map rendering for richer contact visualization.
