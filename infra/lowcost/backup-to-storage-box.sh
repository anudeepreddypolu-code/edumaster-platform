#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/edumaster}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-lowcost-postgres-1}"
APP_CONTAINER="${APP_CONTAINER:-lowcost-app-1}"
STORAGE_BOX_HOST="${STORAGE_BOX_HOST:-}"
STORAGE_BOX_USER="${STORAGE_BOX_USER:-}"
STORAGE_BOX_PATH="${STORAGE_BOX_PATH:-backups/edumaster}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

if [[ -z "${STORAGE_BOX_HOST}" || -z "${STORAGE_BOX_USER}" ]]; then
  echo "STORAGE_BOX_HOST and STORAGE_BOX_USER must be set." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "[backup] exporting postgres"
docker exec "${POSTGRES_CONTAINER}" pg_dump -U postgres -d edumaster | gzip > "${BACKUP_DIR}/postgres.sql.gz"

echo "[backup] archiving app private state"
docker exec "${APP_CONTAINER}" sh -lc "tar -C /app -czf - private_uploads uploads" > "${BACKUP_DIR}/app-state.tar.gz"

echo "[backup] syncing to storage box"
rsync -az --delete "${BACKUP_DIR}/" "${STORAGE_BOX_USER}@${STORAGE_BOX_HOST}:${STORAGE_BOX_PATH}/${TIMESTAMP}/"

echo "[backup] done: ${TIMESTAMP}"
