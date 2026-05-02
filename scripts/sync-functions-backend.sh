#!/bin/zsh
set -euo pipefail

mkdir -p functions/backend
rsync -a --delete \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'api-test.log' \
  backend/ functions/backend/

echo "Synced backend/ to functions/backend/"
