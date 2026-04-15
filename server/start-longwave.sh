#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -x ".venv/bin/python" ]]; then
  echo "Missing .venv/bin/python. Create a virtual environment and install server requirements first." >&2
  exit 1
fi

.venv/bin/python -m alembic upgrade head

HOST_VALUE="${HOST:-0.0.0.0}"
PORT_VALUE="${PORT:-8000}"
LOG_LEVEL_VALUE="${LOG_LEVEL:-info}"
SSL_CERTFILE_VALUE="${SSL_CERTFILE:-}"
SSL_KEYFILE_VALUE="${SSL_KEYFILE:-}"

if { [[ -n "$SSL_CERTFILE_VALUE" ]] && [[ -z "$SSL_KEYFILE_VALUE" ]]; } || { [[ -n "$SSL_KEYFILE_VALUE" ]] && [[ -z "$SSL_CERTFILE_VALUE" ]]; }; then
  echo "HTTPS requires both SSL_CERTFILE and SSL_KEYFILE." >&2
  exit 1
fi

UVICORN_ARGS=(
  -m uvicorn app.main:app
  --host "$HOST_VALUE"
  --port "$PORT_VALUE"
  --proxy-headers
  --log-level "$LOG_LEVEL_VALUE"
)

if [[ -n "$SSL_CERTFILE_VALUE" && -n "$SSL_KEYFILE_VALUE" ]]; then
  UVICORN_ARGS+=(--ssl-certfile "$SSL_CERTFILE_VALUE" --ssl-keyfile "$SSL_KEYFILE_VALUE")
fi

exec .venv/bin/python "${UVICORN_ARGS[@]}"
