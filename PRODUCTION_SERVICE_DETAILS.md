# Production Service Details

Use this checklist when you are ready for the real 1k-student deployment.

## Required

- App domain: `app.example.com`
- Live domain: `live.example.com`
- Hetzner SSH target: `root@SERVER_IP`
- Cloudflare DNS/proxy enabled for app and live domains
- Cloudflare R2 bucket name
- Cloudflare R2 account ID
- Cloudflare R2 endpoint: `https://ACCOUNT_ID.r2.cloudflarestorage.com`
- Cloudflare R2 access key ID
- Cloudflare R2 secret access key
- Production admin email
- Production admin password

## Secrets To Generate

- `JWT_SECRET`
- `PRIVATE_VIDEO_TOKEN_SECRET`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `LIVE_INGEST_PUBLISHER_SECRET`

## Recommended Production Values

```env
NODE_ENV=production
ALLOW_MEMORY_FALLBACK=false
AUTO_SEED_DEMO_DATA=false
ENABLE_DEV_SEED_ROUTES=false
EXPOSE_SAMPLE_CREDENTIALS=false
COURSE_DEFAULT_VALIDITY_DAYS=183
VIDEO_REPLAY_VIEW_LIMIT_ENABLED=false
VIDEO_REPLAY_MAX_VIEWS=0
LIVE_CLASS_MAX_ATTENDEES=2500
PRIVATE_VIDEO_STORAGE_PROVIDER=s3
S3_REGION=auto
S3_FORCE_PATH_STYLE=false
ENABLE_VIDEO_TRANSCODING=true
VIDEO_TARGET_RENDITIONS=480p,720p
VIDEO_HLS_SEGMENT_DURATION_SECONDS=6
```

## Do Not Share Publicly

Never put these in screenshots, public GitHub commits, or frontend code:

- R2 secret access key
- `JWT_SECRET`
- `PRIVATE_VIDEO_TOKEN_SECRET`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `LIVE_INGEST_PUBLISHER_SECRET`
- production admin password
