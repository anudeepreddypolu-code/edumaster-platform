#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

POSTGRES_URL_VALUE="${POSTGRES_URL:-}"
if [[ -z "$POSTGRES_URL_VALUE" && -f "$REPO_ROOT/.env" ]]; then
  POSTGRES_URL_VALUE="$(awk -F= '/^POSTGRES_URL=/{print substr($0, index($0, "=") + 1)}' "$REPO_ROOT/.env" | tail -n 1)"
fi

POSTGRES_URL_NO_SCHEME="${POSTGRES_URL_VALUE#postgresql://}"
POSTGRES_URL_AUTH_HOST="${POSTGRES_URL_NO_SCHEME%%/*}"
POSTGRES_URL_HOST_PORT="${POSTGRES_URL_AUTH_HOST##*@}"
POSTGRES_URL_DB_NAME="${POSTGRES_URL_NO_SCHEME#*/}"
POSTGRES_URL_DB_NAME="${POSTGRES_URL_DB_NAME%%\?*}"
POSTGRES_URL_USER=""
if [[ "$POSTGRES_URL_AUTH_HOST" == *"@"* ]]; then
  POSTGRES_URL_USERINFO="${POSTGRES_URL_AUTH_HOST%%@*}"
  POSTGRES_URL_USER="${POSTGRES_URL_USERINFO%%:*}"
fi
POSTGRES_URL_PORT="${POSTGRES_URL_HOST_PORT##*:}"

if [[ "$POSTGRES_URL_HOST_PORT" == "$POSTGRES_URL_PORT" ]]; then
  POSTGRES_URL_PORT=""
fi

PGDATA_DIR="${PGDATA_DIR:-/tmp/edumaster-pg}"
PGPORT="${PGPORT:-${POSTGRES_URL_PORT:-15432}}"
PG_SUPERUSER="${PG_SUPERUSER:-${POSTGRES_URL_USER:-postgres}}"
APP_DB_NAME="${APP_DB_NAME:-${POSTGRES_URL_DB_NAME:-edumaster}}"
LOCAL_OWNER="${LOCAL_OWNER:-$USER}"

if [[ -x "/Library/PostgreSQL/18/bin/initdb" ]]; then
  INITDB_BIN="/Library/PostgreSQL/18/bin/initdb"
  PG_CTL_BIN="/Library/PostgreSQL/18/bin/pg_ctl"
elif command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1; then
  INITDB_BIN="$(command -v initdb)"
  PG_CTL_BIN="$(command -v pg_ctl)"
else
  echo "PostgreSQL binaries not found. Install PostgreSQL 18 or add initdb/pg_ctl to PATH."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but was not found in PATH."
  exit 1
fi

has_cluster_contents() {
  [[ -d "$1/base" || -d "$1/global" || -d "$1/pg_wal" ]]
}

if [[ ! -f "$PGDATA_DIR/PG_VERSION" ]]; then
  if [[ -d "$PGDATA_DIR" ]] && [[ -n "$(ls -A "$PGDATA_DIR" 2>/dev/null)" ]]; then
    if has_cluster_contents "$PGDATA_DIR"; then
      STALE_BACKUP_DIR="${PGDATA_DIR}.stale.$(date +%Y%m%d-%H%M%S)"
      echo "Found stale local Postgres data dir without PG_VERSION at $PGDATA_DIR"
      echo "Moving it aside to $STALE_BACKUP_DIR and creating a fresh local cluster."
      mv "$PGDATA_DIR" "$STALE_BACKUP_DIR"
    else
      echo "Found non-empty PGDATA_DIR at $PGDATA_DIR without a valid cluster."
      echo "Please empty it or set PGDATA_DIR to a different path."
      exit 1
    fi
  fi

  mkdir -p "$PGDATA_DIR"
  "$INITDB_BIN" -D "$PGDATA_DIR"
fi

if ! lsof -nP -iTCP:"$PGPORT" >/dev/null 2>&1; then
  "$PG_CTL_BIN" -D "$PGDATA_DIR" -o "-p $PGPORT" -l "$PGDATA_DIR/server.log" start
fi

for _ in {1..10}; do
  if psql "postgresql://${LOCAL_OWNER}@127.0.0.1:${PGPORT}/postgres" -c "select 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql "postgresql://${LOCAL_OWNER}@127.0.0.1:${PGPORT}/postgres" -tc "select 1 from pg_roles where rolname = '${PG_SUPERUSER}'" | grep -q 1 \
  || psql "postgresql://${LOCAL_OWNER}@127.0.0.1:${PGPORT}/postgres" -c "create role ${PG_SUPERUSER} login superuser;"

psql "postgresql://${PG_SUPERUSER}@127.0.0.1:${PGPORT}/postgres" -tc "select 1 from pg_database where datname = '${APP_DB_NAME}'" | grep -q 1 \
  || createdb -h 127.0.0.1 -p "$PGPORT" -U "$PG_SUPERUSER" "$APP_DB_NAME"

echo "Local Postgres ready on 127.0.0.1:${PGPORT} (db=${APP_DB_NAME}, user=${PG_SUPERUSER})"
