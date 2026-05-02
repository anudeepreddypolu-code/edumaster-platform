#!/usr/bin/env bash
set -euo pipefail

: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
: "${R2_BUCKET:?Set R2_BUCKET}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY}"

LOCAL_HLS_ROOT="${LOCAL_HLS_ROOT:-/var/www/hls}"
R2_PREFIX="${R2_PREFIX:-live-hls}"
SYNC_INTERVAL_SECONDS="${SYNC_INTERVAL_SECONDS:-5}"

export RCLONE_CONFIG_R2_TYPE="s3"
export RCLONE_CONFIG_R2_PROVIDER="Cloudflare"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET="true"

echo "[r2-sync] syncing ${LOCAL_HLS_ROOT} to r2:${R2_BUCKET}/${R2_PREFIX}"

while true; do
  rclone sync "${LOCAL_HLS_ROOT}" "r2:${R2_BUCKET}/${R2_PREFIX}" \
    --fast-list \
    --transfers 16 \
    --checkers 32 \
    --s3-no-check-bucket \
    --delete-delay 15s

  sleep "${SYNC_INTERVAL_SECONDS}"
done
