#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_TARGET="${1:-}"
REMOTE_DIR="${2:-/opt/edumaster}"

if [[ -z "${REMOTE_TARGET}" ]]; then
  echo "Usage: $0 <user@server> [remote-dir]" >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/.env.production" ]]; then
  echo ".env.production is missing in ${ROOT_DIR}" >&2
  exit 1
fi

echo "[deploy] validating production env"
(cd "${ROOT_DIR}" && npm run validate:production)

echo "[deploy] building frontend locally"
(cd "${ROOT_DIR}" && npm run build)

echo "[deploy] syncing project to ${REMOTE_TARGET}:${REMOTE_DIR}"
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "backend/node_modules" \
  --exclude "dist" \
  --exclude "qa-automation/.dist" \
  "${ROOT_DIR}/" "${REMOTE_TARGET}:${REMOTE_DIR}/"

echo "[deploy] starting compose stack on remote host"
ssh "${REMOTE_TARGET}" "cd '${REMOTE_DIR}/infra/lowcost' && docker compose --env-file ../../.env.production -f docker-compose.prod.yml up -d --build"

echo "[deploy] deployment complete"
