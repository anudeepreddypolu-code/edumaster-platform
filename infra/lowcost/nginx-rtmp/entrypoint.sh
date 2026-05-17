#!/usr/bin/env bash
set -euo pipefail

: "${NGINX_RTMP_INGEST_CALLBACK_URL:=http://app:5000/backend/api/live-classes/ingest/on-publish}"
: "${LIVE_INGEST_PUBLISHER_SECRET:=}"

export NGINX_RTMP_INGEST_CALLBACK_URL
export LIVE_INGEST_PUBLISHER_SECRET

envsubst '${NGINX_RTMP_INGEST_CALLBACK_URL} ${LIVE_INGEST_PUBLISHER_SECRET}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

exec nginx -g 'daemon off;'
