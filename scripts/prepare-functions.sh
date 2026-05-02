#!/bin/bash
set -e

echo "Copying backend into functions/..."
rm -rf functions/backend
cp -r backend functions/backend

rm -rf functions/backend/__tests__
rm -rf functions/backend/test
rm -f functions/backend/nodemon.json
rm -f functions/backend/test-api.js
rm -f functions/backend/load-test.js

echo "Installing functions dependencies..."
cd functions && npm install --prefer-offline
cd ..

echo "Functions ready."
