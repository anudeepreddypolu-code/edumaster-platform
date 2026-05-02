#!/bin/zsh
set -euo pipefail

PROJECT_ID="${1:-}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: ./deploy-quick.sh <firebase-project-id>"
  exit 1
fi

npm run validate:production
npm run build
firebase deploy --project "$PROJECT_ID" --only hosting,functions
