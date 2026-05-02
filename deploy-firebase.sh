#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# EduMaster Firebase Deploy Script
# Usage: ./deploy-firebase.sh
#
# What this does:
#   1. Builds the React frontend with Firebase env vars
#   2. Deploys to Firebase Hosting
#
# Prerequisites:
#   - npm install -g firebase-tools
#   - firebase login
#   - Fill in .env.firebase with your backend URL
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "🔍 Checking prerequisites..."

if ! command -v firebase &> /dev/null; then
  echo "❌ firebase-tools not found. Install with: npm install -g firebase-tools"
  exit 1
fi

if [ ! -f ".env.firebase" ]; then
  echo "❌ .env.firebase not found. Copy it and fill in your backend URL."
  exit 1
fi

# Check VITE_API_BASE_URL is set and not placeholder
BACKEND_URL=$(grep "VITE_API_BASE_URL" .env.firebase | cut -d'=' -f2)
if [[ "$BACKEND_URL" == *"YOUR_BACKEND_URL"* ]] || [ -z "$BACKEND_URL" ]; then
  echo "❌ VITE_API_BASE_URL in .env.firebase is not set."
  echo "   Deploy your backend first, then update .env.firebase with the URL."
  echo "   See DEPLOYMENT.md for backend deployment options."
  exit 1
fi

echo "✅ Backend URL: $BACKEND_URL"
echo ""
echo "📦 Building frontend for Firebase..."

# Copy firebase env as .env.local so Vite picks it up
cp .env.firebase .env.local
npm run build
rm -f .env.local

echo ""
echo "🚀 Deploying to Firebase Hosting..."
firebase deploy --only hosting

echo ""
echo "✅ Deployed! Your app is live at:"
firebase hosting:channel:list 2>/dev/null || true
echo "   https://$(grep '"default"' .firebaserc | cut -d'"' -f4).web.app"
echo ""
echo "📋 Next steps:"
echo "   1. Open the URL above on any device"
echo "   2. Register an account"
echo "   3. Promote to admin in your database:"
echo "      UPDATE users SET role = 'admin' WHERE email = 'your@email.com';"
