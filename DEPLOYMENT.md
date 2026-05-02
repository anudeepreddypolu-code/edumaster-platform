# EduMaster — Deployment Guide

## Architecture for Firebase Hosting

```
┌─────────────────────────────────────────────────────────┐
│  User's browser / mobile                                 │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────┐    ┌──────────────────────┐
│  Firebase Hosting           │    │  Backend (Cloud Run / │
│  (React SPA — free)         │───▶│  Railway / Render)    │
│  your-app.web.app           │    │  Node.js + Postgres   │
└─────────────────────────────┘    └──────────────────────┘
```

Firebase Hosting serves the **frontend only** (static files).
The **backend** (Node.js API + database) runs on a separate service.

---

## Step 1 — Deploy the backend (pick one free option)

### Option A: Railway (easiest, free tier)

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select this repo
3. Set **Root Directory** to `/` and **Start Command** to `node backend/server.cjs`
4. Add a **Postgres** plugin from Railway dashboard
5. Set environment variables (copy from `.env.production`, fill in values):
   ```
   NODE_ENV=production
   PORT=8080
   APP_URL=https://your-app.railway.app
   JWT_SECRET=<openssl rand -hex 64>
   PRIVATE_VIDEO_TOKEN_SECRET=<openssl rand -hex 64>
   CORS_ORIGIN=https://gen-lang-client-0187778964.web.app
   POSTGRES_URL=<auto-filled by Railway Postgres plugin>
   ALLOW_MEMORY_FALLBACK=false
   AUTO_SEED_DEMO_DATA=false
   EXPOSE_SAMPLE_CREDENTIALS=false
   FIREBASE_PROJECT_ID=gen-lang-client-0187778964
   ```
6. Railway gives you a URL like `https://your-app.railway.app`

### Option B: Render (free tier, sleeps after 15min inactivity)

1. Go to [render.com](https://render.com) → New Web Service → Connect GitHub
2. Build Command: `cd backend && npm ci`
3. Start Command: `node backend/server.cjs`
4. Add a **Postgres** database from Render dashboard
5. Set the same environment variables as above
6. Render gives you `https://your-app.onrender.com`

### Option C: Google Cloud Run (pay-per-request, very cheap)

```bash
# Build and push backend image
docker build -f Dockerfile.backend -t gcr.io/gen-lang-client-0187778964/edumaster-backend .
docker push gcr.io/gen-lang-client-0187778964/edumaster-backend

# Deploy to Cloud Run
gcloud run deploy edumaster-backend \
  --image gcr.io/gen-lang-client-0187778964/edumaster-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,PORT=8080,...
```

---

## Step 2 — Configure frontend to point to your backend

Edit `.env.firebase` and set your backend URL:

```bash
# .env.firebase
VITE_API_BASE_URL=https://your-backend-url.railway.app/backend/api
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_REPLACE_ME
```

---

## Step 3 — Deploy frontend to Firebase Hosting

### First time setup

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Verify project
firebase projects:list
```

### Deploy

```bash
# One command deploy
./deploy-firebase.sh

# Or manually:
npm run deploy:firebase
```

Your app will be live at:
- `https://gen-lang-client-0187778964.web.app`
- `https://gen-lang-client-0187778964.firebaseapp.com`

---

## Step 4 — Create your admin account

1. Open your Firebase Hosting URL on any device
2. Click **Create account** and register with your email
3. In your backend database, promote to admin:

**Railway / Render Postgres:**
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

**Via Railway dashboard:** Open the Postgres plugin → Query tab → run the SQL above.

---

## Step 5 — Test on any device

Open `https://gen-lang-client-0187778964.web.app` on:
- Your phone (Android/iOS)
- Any browser
- Share the URL with anyone

No server setup needed on the device — it's all hosted.

---

## Quick reference

| Command | What it does |
|---|---|
| `npm run build:firebase` | Build frontend with Firebase env |
| `npm run deploy:firebase` | Build + deploy to Firebase Hosting |
| `./deploy-firebase.sh` | Full deploy with checks |
| `firebase hosting:channel:create preview` | Create a preview URL for testing |
| `firebase deploy --only hosting` | Deploy hosting only |

---

## Updating the app

```bash
# Make your changes, then:
npm run deploy:firebase
```

Firebase Hosting deploys in ~30 seconds with zero downtime.

---

## Custom domain (optional)

1. Firebase Console → Hosting → Add custom domain
2. Add DNS records as instructed
3. Update `CORS_ORIGIN` in your backend env to your custom domain
4. Redeploy backend

---

## Local development (unchanged)

```bash
npm run dev          # Full stack local dev
npm run dev:seed     # Seed local database
```
