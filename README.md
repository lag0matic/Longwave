# Longwave

Longwave is a desktop-first ham radio logging application for self-hosted operators who want:

- cloud-synced logbooks across their own devices
- POTA hunting and activating workflows
- QRZ callsign lookup and QRZ log upload
- ADIF import/export
- local FLrig-compatible rig control from the client machine

Longwave is currently built as:

- `server/`: a self-hosted FastAPI API for log storage, sync, QRZ integration, ADIF workflows, and POTA spot fetch/post
- `client/`: a React + TypeScript desktop app with a Tauri shell for Windows and Linux

## Project Status

Longwave is already usable for real logging workflows, but it is still an actively developed project and may contain bugs, rough edges, or incomplete polish.

This project was built with substantial help from OpenAI Codex.

## Current Feature Set

- self-hosted single-operator server
- Windows desktop client
- Linux desktop client
- multi-logbook workflow
- standard logbooks
- POTA hunting logbooks
- POTA activating logbooks
- logbook creation and deletion
- ADIF import into a new logbook
- ADIF export from a logbook
- QRZ callsign lookup
- QRZ log upload
- POTA spots view with filtering
- POTA spot posting
- contact map
- cross-device sync through the self-hosted server
- desktop certificate trust workflow for self-signed HTTPS
- FLrig-compatible local rig read/tune workflow from the client app

## Architecture

- The server is intended to run on your own machine, typically a Windows box at home or in the shack.
- The desktop clients connect to that server over LAN or remote HTTPS.
- Rig control is client-side only. The computer running the desktop app is the one that talks to FLrig or ShackStack.
- QRZ calls are made server-side, not directly from the client.

## Running The Server

The Windows server is the primary supported host right now.

### Windows packaged host

The Windows packaged host is:

- `server/dist/LongwaveServer.exe`

That host:

- runs migrations on startup
- starts the API in the background
- shows server health
- shows the client/admin API tokens

Runtime data lives under:

- `%LOCALAPPDATA%\LongwaveServer`

Important runtime files include:

- `%LOCALAPPDATA%\LongwaveServer\.env`
- `%LOCALAPPDATA%\LongwaveServer\longwave.db`

### Server configuration

Copy or create `%LOCALAPPDATA%\LongwaveServer\.env` and set the values you need.

Typical production-style settings:

```env
ENVIRONMENT=production
DATABASE_URL=sqlite:///./longwave.db
HOST=0.0.0.0
PORT=443
SSL_CERTFILE=C:\Longwave\certs\fullchain.pem
SSL_KEYFILE=C:\Longwave\certs\privkey.pem
ALLOWED_HOSTS=radio.example.net,127.0.0.1,localhost,192.168.1.50
ENABLE_DOCS=false
PUBLIC_HEALTHCHECK=false
SEED_DEMO_DATA=false
```

If you are running the server on your LAN only, you can use a non-HTTPS local setup while testing. For remote use, HTTPS is strongly recommended.

More server-specific detail is in:

- [server/README.md](C:/Users/lag0m/Documents/Longwave/server/README.md)

## Self-Signed HTTPS Setup

Longwave currently supports a self-signed HTTPS workflow for personal remote access.

### 1. Generate the certificate on the Windows server

If you already have OpenSSL installed:

```powershell
mkdir C:\Longwave\certs -Force
cd C:\Longwave\certs

& "C:\Program Files\OpenSSL-Win64\bin\openssl.exe" req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes `
  -keyout privkey.pem `
  -out fullchain.pem `
  -subj "/CN=radio.example.net" `
  -addext "subjectAltName=DNS:radio.example.net"
```

If OpenSSL is not installed yet:

```powershell
winget install ShiningLight.OpenSSL.Light
```

Then reopen PowerShell and run the certificate command above.

### 2. Point the Windows server at the certificate

Edit:

- `%LOCALAPPDATA%\LongwaveServer\.env`

And set:

```env
HOST=0.0.0.0
PORT=443
SSL_CERTFILE=C:\Longwave\certs\fullchain.pem
SSL_KEYFILE=C:\Longwave\certs\privkey.pem
ALLOWED_HOSTS=radio.example.net,127.0.0.1,localhost,192.168.1.50
```

Then restart `LongwaveServer.exe`.

### 3. Open the firewall / router

- allow `TCP 443` through Windows Firewall
- forward `TCP 443` on your router to the Windows server if you want remote access from outside your LAN

### 4. Trust the server from the desktop app

The desktop client does not rely on the OS certificate store anymore for Longwave itself.

Instead:

1. set your primary and fallback server URLs in the desktop app
2. click `Trust Server`
3. Longwave pins the server identity for future connections

This means you do **not** need to manually install the certificate on every desktop client just to use Longwave.

## Running The Desktop Client

### Windows

Development desktop build:

- `client/src-tauri/target/debug/longwave.exe`

Windows installers built from Tauri:

- `client/src-tauri/target/release/bundle/msi/Longwave_0.1.0_x64_en-US.msi`
- `client/src-tauri/target/release/bundle/nsis/Longwave_0.1.0_x64-setup.exe`

### Linux

The Linux desktop client is built from the same Tauri app.

For local development:

```bash
cd client
npm install
npm run tauri:build -- --no-bundle
./src-tauri/target/release/longwave
```

For packaged Linux builds, GitHub Actions now produces an AppImage artifact.

### Browser preview

The browser preview is useful for UI work, but it is not the full desktop runtime.

```bash
cd client
npm install
npm run dev
```

Desktop-only features include:

- local certificate trust / pinned server identity
- desktop ADIF import
- local FLrig/ShackStack control

## Desktop Setup Flow

The desktop app currently supports:

1. primary server endpoint
2. fallback server endpoints
3. server trust / pinned fingerprint
4. client token
5. admin token
6. station settings

Typical example:

- primary endpoint: `https://192.168.1.50/api/v1`
- fallback endpoint: `https://radio.example.net/api/v1`

## Development

### Client

```bash
cd client
npm install
npm run build
```

### Windows desktop build

```powershell
cd client
npm run tauri:build
```

### Server

```powershell
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m alembic upgrade head
python .\windows_host.py
```

## Notes And Caveats

- Longwave is intentionally self-hosted and currently assumes one operator per server instance.
- Mobile is not the focus right now.
- Offline support is still evolving. The goal is offline QSO capture first, with later sync once connectivity returns.
- FLrig support is desktop-only and should not be expected to work on mobile.
- ShackStack on Windows is treated as an FLrig-compatible endpoint.

## License

This project is licensed under the MIT License.

See:

- [LICENSE](C:/Users/lag0m/Documents/Longwave/LICENSE)
