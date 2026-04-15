# Longwave Server

This folder is the self-hosted Longwave API. It is designed to run on one operator's own machine or server and provide:

- canonical logbook and QSO storage
- QRZ lookup and QRZ logbook upload
- POTA spot fetch/post support
- ADIF import/export
- sync for multiple client devices

## Production defaults

The production-oriented behavior is now:

- no demo data is seeded unless `SEED_DEMO_DATA=true`
- CORS is controlled by `CORS_ORIGINS`
- host-header validation is controlled by `ALLOWED_HOSTS`
- FastAPI docs/OpenAPI are disabled unless `ENABLE_DOCS=true`
- `/health` is private unless `PUBLIC_HEALTHCHECK=true`
- repeated bad token attempts are throttled
- client and admin API tokens can be split for safer remote use
- schema upgrades are applied before startup by the provided launch scripts

## Environment

Copy `.env.example` to `.env` and adjust at least:

- `DATABASE_URL`
- `HOST`
- `PORT`
- `SSL_CERTFILE` / `SSL_KEYFILE` if you want direct HTTPS from Longwave
- `CORS_ORIGINS`
- `ALLOWED_HOSTS`
- `QRZ_USERNAME`
- `QRZ_PASSWORD`
- `QRZ_API_KEY`
- `POTA_API_KEY`

Example local SQLite deployment:

```env
ENVIRONMENT=production
DATABASE_URL=sqlite:///./longwave.db
HOST=0.0.0.0
PORT=8000
SSL_CERTFILE=
SSL_KEYFILE=
CORS_ORIGINS=http://192.168.1.50:4173,http://localhost:4173
ALLOWED_HOSTS=127.0.0.1,localhost,192.168.1.50,your-public-dns-name
ENABLE_DOCS=false
PUBLIC_HEALTHCHECK=false
SEED_DEMO_DATA=false
```

Example PostgreSQL deployment:

```env
ENVIRONMENT=production
DATABASE_URL=postgresql+psycopg://longwave:password@db-host/longwave
HOST=0.0.0.0
PORT=8000
SSL_CERTFILE=
SSL_KEYFILE=
CORS_ORIGINS=http://192.168.1.50:4173,http://localhost:4173
ALLOWED_HOSTS=127.0.0.1,localhost,192.168.1.50,your-public-dns-name
ENABLE_DOCS=false
PUBLIC_HEALTHCHECK=false
SEED_DEMO_DATA=false
```

## Internet exposure notes

If you expose the server outside your home network, treat these as the minimum:

- keep `ENABLE_DOCS=false`
- keep `PUBLIC_HEALTHCHECK=false`
- set `ALLOWED_HOSTS` to your exact DNS name or known host/IP values
- use a long API token and rotate it if you suspect it leaked
- enable HTTPS with `SSL_CERTFILE` and `SSL_KEYFILE`
- prefer `PORT=443` when you are terminating TLS directly in Longwave
- do not expose a broad `*` host policy

This app now validates host headers, throttles repeated failed token attempts, keeps the health endpoint private by default, and supports split client/admin API tokens. That is stronger than before, but still not equivalent to a fully zero-trust internet service.

Longwave now supports a split-token model:

- `client token`: daily app use such as logbooks, QSOs, sync, QRZ lookup/upload, and spots
- `admin token`: settings changes and token rotation

Existing installs are migrated conservatively by cloning the old token into both roles first. After the updated client is paired, rotate the admin and client tokens apart.

## Direct HTTPS

Longwave can terminate TLS directly with Uvicorn if you provide a certificate and private key.

Example:

```env
HOST=0.0.0.0
PORT=443
SSL_CERTFILE=C:\Longwave\certs\fullchain.pem
SSL_KEYFILE=C:\Longwave\certs\privkey.pem
ALLOWED_HOSTS=your-public-dns-name
```

Notes:

- both `SSL_CERTFILE` and `SSL_KEYFILE` must be set together
- use a certificate whose hostname matches the public DNS name clients will use
- if you open the server through Windows Firewall, open the TLS port you choose, typically `TCP 443`
- the Windows host GUI can still monitor health when using self-signed certificates, but clients should use a real trusted certificate if you plan to connect from the internet

## Windows launch

For the production-style Windows experience, use the bundled host application.

1. Create a virtual environment in `server/.venv`
2. Install `requirements.txt`
3. Create `server/.env`
4. Run:

```powershell
python .\windows_host.py
```

That host window:

- applies database migrations on startup
- starts the API in the background
- shows server status and health
- displays both the client token and admin token for pairing clients and admin access
- supports HTTPS automatically when `SSL_CERTFILE` and `SSL_KEYFILE` are configured
- lets you stop/start the server without using a terminal

To build a Windows executable:

```powershell
.\build-windows-host.ps1
```

That produces:

- `server/dist/LongwaveServer.exe`

If you still want a console-first launch path on Windows, `.\start-longwave.ps1` remains available.

## Linux launch

1. Create a virtual environment in `server/.venv`
2. Install `requirements.txt`
3. Create `server/.env`
4. Run:

```bash
chmod +x start-longwave.sh
./start-longwave.sh
```

## Linux service

For a long-running Linux install, use [deploy/longwave.service](C:/Users/lag0m/Documents/Longwave/server/deploy/longwave.service) as a starting point for a `systemd` unit.

## Docker

Build:

```bash
docker build -t longwave-server .
```

Run:

```bash
docker run --rm -p 8000:8000 --env-file .env -v longwave-data:/app longwave-server
```

If you use SQLite in Docker, mount persistent storage. For multi-device production use, PostgreSQL is the better target.

## Deployment checklist

1. Copy `server/` to the production machine.
2. Create and populate `.env`.
3. Create `.venv` and install dependencies, or build the Docker image.
4. Run `alembic upgrade head`.
5. Start the server with the provided script or service unit.
6. Pair the client using the server's API token already stored in the app settings row.

## Notes

- The API token lives in the local database settings record and is still the client auth mechanism.
- FLrig/ShackStack stays client-side and does not require server deployment support.
- If you want clean backups, back up both the database and the `.env` file.
