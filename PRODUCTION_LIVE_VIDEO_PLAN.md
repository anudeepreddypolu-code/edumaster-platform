# Production Live Video Plan

## Recommended low-cost stack

Use this stack if you want production-ready live classes without paying for a heavy all-in-one video platform:

1. Live classes:
Jitsi Meet for small-to-medium live sessions when you want the lowest starting cost.

2. Recorded replay storage:
S3-compatible object storage with `PRIVATE_VIDEO_STORAGE_PROVIDER=s3`.

3. Replay delivery:
Keep `ENABLE_VIDEO_TRANSCODING=true` so uploaded recordings become HLS and students can watch adaptive playback.

4. App database:
Postgres for production data, Redis if you want stronger session/cache scaling.

## Best choice for your current size

For roughly 300 students, 2 hours per day, over 6 months, the lowest-cost implementation in this repo is:

- self-hosted Jitsi for live classes
- Cloudflare R2 or another S3-compatible low-cost object store for replay videos
- HLS renditions limited to `480p,720p`
- delete original source after HLS processing

This is the cheapest path that still keeps replay videos inside your app with protected access.

## Best fit for this repo

This app already supports:

- secure private lesson playback
- HLS replay generation
- S3-compatible storage
- live class replay linked back into the course lesson path

Because of that, the lowest-friction production shape is:

- live class runs in Jitsi or LiveKit
- admin records the class in browser
- recording uploads into the course/module path
- backend converts it to HLS
- students watch the protected replay from the same app

## Environment checklist

Set these before production launch:

```env
NODE_ENV=production
ALLOW_MEMORY_FALLBACK=false
CORS_ORIGIN=https://yourdomain.com
JWT_SECRET=replace_with_long_random_secret
PRIVATE_VIDEO_TOKEN_SECRET=replace_with_long_random_secret
PRIVATE_VIDEO_STORAGE_PROVIDER=s3
S3_BUCKET=replace_me
S3_REGION=ap-south-1
S3_ENDPOINT=https://your-s3-compatible-endpoint
S3_ACCESS_KEY_ID=replace_me
S3_SECRET_ACCESS_KEY=replace_me
ENABLE_VIDEO_TRANSCODING=true
VIDEO_TARGET_RENDITIONS=480p,720p
VIDEO_KEEP_SOURCE_AFTER_PROCESSING=false
```

## Cost-conscious defaults

- Keep renditions to `480p,720p` instead of generating many qualities.
- Keep `VIDEO_KEEP_SOURCE_AFTER_PROCESSING=false` so the original file is removed after HLS creation.
- Use browser recording upload for now instead of a paid recording SaaS.
- Start with Jitsi if you need the lowest recurring live-class cost.
- Move to LiveKit when you need stronger in-app studio quality and scaling.

## Operational notes

- Run the backend where `ffmpeg` is available because replay processing depends on it.
- Put object storage behind HTTPS.
- Keep uploads private and serve playback only through signed app URLs.
- Use a CDN in front of your object storage when replay traffic becomes large.
