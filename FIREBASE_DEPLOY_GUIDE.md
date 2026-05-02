# Firebase Deploy Guide

This repo can now run as a single Firebase stack:

- Firebase Hosting for the Vite frontend
- Firebase Functions for the Node/Express API
- Optional MongoDB Atlas or Postgres for persistent data

## What changed

- demo seed routes are disabled by default
- sample credentials are no longer exposed in the UI
- content is not auto-seeded unless you explicitly enable `AUTO_SEED_DEMO_DATA=true`
- the app can deploy without keeping a separate Node server running

## 1. Prepare Firebase

```bash
firebase login
firebase use --add
```

You can also skip `firebase use --add` and deploy with a project id directly.

## 2. Configure function secrets and runtime env

Start from [functions/.env.example](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/functions/.env.example:1) and create `functions/.env`.

Minimum production-safe values:

```bash
NODE_ENV=production
APP_URL=https://YOUR_PROJECT_ID.web.app
CORS_ORIGIN=https://YOUR_PROJECT_ID.web.app
JWT_SECRET=replace_with_long_random_secret
PRIVATE_VIDEO_TOKEN_SECRET=replace_with_long_random_secret
ALLOW_MEMORY_FALLBACK=false
AUTO_SEED_DEMO_DATA=false
ENABLE_DEV_SEED_ROUTES=false
EXPOSE_SAMPLE_CREDENTIALS=false
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=replace_with_strong_password
```

For persistent data, add one database:

```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/edumaster
```

or

```bash
POSTGRES_URL=postgresql://username:password@host:5432/edumaster
```

## 3. Build and deploy

```bash
./deploy-quick.sh YOUR_FIREBASE_PROJECT_ID
```

That does:

```bash
npm run build
firebase deploy --project YOUR_FIREBASE_PROJECT_ID --only hosting,functions
```

## 4. Free testing notes

- Firebase Hosting has a generous free tier and works well for global testing.
- Firebase Functions can be used for lightweight testing, but heavy traffic, video processing, or lots of API calls can leave the free tier.
- For true production persistence, use MongoDB Atlas free tier or a small Postgres instance.
- Local disk uploads inside Functions are not durable. For real uploaded videos/files, configure S3-compatible storage.

## 5. Important limitation

This setup removes the need for a dedicated always-on server, but it does not make video storage/transcoding free worldwide. If you want reliable uploads and replay media, add object storage such as S3/R2/B2.
