#!/bin/bash
# Run this AFTER upgrading to Blaze plan at:
# https://console.firebase.google.com/project/gen-lang-client-0187778964/usage/details
set -e
echo "Preparing functions..."
bash scripts/prepare-functions.sh
echo "Deploying functions..."
firebase deploy --only functions
echo ""
echo "Done! Your app is fully live at:"
echo "https://gen-lang-client-0187778964.web.app"
