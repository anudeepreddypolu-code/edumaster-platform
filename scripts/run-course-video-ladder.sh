#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_BASE_URL_VALUE="${QA_BASE_URL:-${1:-}}"
PREPARE_COUNT="${COURSE_LOAD_PREPARE_USERS:-1000}"
SETUP_CONCURRENCY="${COURSE_LOAD_SETUP_CONCURRENCY:-3}"
TIMEOUT_MS="${COURSE_LOAD_TIMEOUT_MS:-30000}"
MANIFEST_FILE="${COURSE_LOAD_USERS_FILE:-}"
COURSE_ID_VALUE="${COURSE_LOAD_COURSE_ID:-course_1899470118af44b4b9447b35fd296761}"
LESSON_ID_VALUE="${COURSE_LOAD_LESSON_ID:-video_1778758229576}"

if [[ -z "${QA_BASE_URL_VALUE}" ]]; then
  echo "Usage: QA_BASE_URL=https://app.example.com $0" >&2
  echo "   or: $0 https://app.example.com" >&2
  exit 1
fi

run_course_video_load() {
  local users="$1"
  local active_concurrency="$2"
  local prepare_only="${3:-false}"

  echo "[course-video] starting run: users=${users} active=${active_concurrency} prepare_only=${prepare_only}"
  (
    cd "${ROOT_DIR}"
    QA_BASE_URL="${QA_BASE_URL_VALUE}" \
    COURSE_LOAD_USERS="${users}" \
    COURSE_LOAD_ACTIVE_CONCURRENCY="${active_concurrency}" \
    COURSE_LOAD_SETUP_CONCURRENCY="${SETUP_CONCURRENCY}" \
    COURSE_LOAD_TIMEOUT_MS="${TIMEOUT_MS}" \
    COURSE_LOAD_COURSE_ID="${COURSE_ID_VALUE}" \
    COURSE_LOAD_LESSON_ID="${LESSON_ID_VALUE}" \
    COURSE_LOAD_PREPARE_ONLY="${prepare_only}" \
    COURSE_LOAD_USERS_FILE="${MANIFEST_FILE}" \
    npm --prefix qa-automation run load:course-video
  )
}

if [[ -z "${MANIFEST_FILE}" ]]; then
  echo "[course-video] no prepared user manifest supplied; running prepare-only pass"
  run_course_video_load "${PREPARE_COUNT}" 0 true
  MANIFEST_FILE="$(ls -td "${ROOT_DIR}"/reports/course-video-1000-*/prepared-users.json 2>/dev/null | head -n 1 || true)"
  if [[ -z "${MANIFEST_FILE}" ]]; then
    echo "[course-video] unable to locate prepared-users.json after prepare-only run" >&2
    exit 1
  fi
  echo "[course-video] using generated manifest: ${MANIFEST_FILE}"
else
  echo "[course-video] using provided manifest: ${MANIFEST_FILE}"
fi

run_course_video_load 250 250 false
run_course_video_load 750 750 false
run_course_video_load 1000 1000 false

echo "[course-video] ladder complete"
