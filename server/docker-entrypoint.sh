#!/usr/bin/env sh
set -eu

python -m alembic upgrade head

SSL_CERTFILE_VALUE="${SSL_CERTFILE:-}"
SSL_KEYFILE_VALUE="${SSL_KEYFILE:-}"

if { [ -n "$SSL_CERTFILE_VALUE" ] && [ -z "$SSL_KEYFILE_VALUE" ]; } || { [ -n "$SSL_KEYFILE_VALUE" ] && [ -z "$SSL_CERTFILE_VALUE" ]; }; then
  echo "HTTPS requires both SSL_CERTFILE and SSL_KEYFILE." >&2
  exit 1
fi

set -- python -m uvicorn app.main:app \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --log-level "${LOG_LEVEL:-info}"

if [ -n "$SSL_CERTFILE_VALUE" ] && [ -n "$SSL_KEYFILE_VALUE" ]; then
  set -- "$@" --ssl-certfile "$SSL_CERTFILE_VALUE" --ssl-keyfile "$SSL_KEYFILE_VALUE"
fi

exec "$@"
