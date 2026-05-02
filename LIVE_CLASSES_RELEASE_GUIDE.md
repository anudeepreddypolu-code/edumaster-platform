# Live Classes Release Guide

This repo now supports three live delivery paths:

1. `livekit`
Realtime in-app classroom for the closest match to the Figma room UI.

2. `hls`
Lowest-cost one-to-many broadcast for large student audiences.

3. `jitsi`
Fallback room mode when you want a quick room-based setup without LiveKit.

## Default behavior

New live classes now prefer:

1. `livekit` when `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are configured
2. `hls` when the managed ingest/origin env is configured
3. `jitsi` otherwise

That preference is applied in both the backend defaults and the admin live-class manager.

## Recommended production stacks

### Exact realtime classroom

Use this when you want the closest behavior to the Figma live room:

- App: Render or Railway
- Database: Supabase Postgres
- Redis / heartbeats: Upstash Redis
- Replay storage: Cloudflare R2
- Realtime: LiveKit

Required env:

```env
POSTGRES_URL=postgresql://postgres.<project-ref>:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
REDIS_URL=rediss://default:PASSWORD@YOUR-REDIS.upstash.io:6379
PRIVATE_VIDEO_STORAGE_PROVIDER=s3
S3_BUCKET=your-r2-bucket
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your_r2_key
S3_SECRET_ACCESS_KEY=your_r2_secret
VITE_LIVEKIT_URL=wss://live.yourdomain.com
LIVEKIT_URL=wss://live.yourdomain.com
LIVEKIT_API_KEY=your_livekit_key
LIVEKIT_API_SECRET=your_livekit_secret
```

### Lowest-cost broadcast

Use this when the teacher is the only publisher and students mainly watch:

- App: Render / Railway / VPS
- Database: Supabase Postgres
- Redis / heartbeats: Upstash Redis
- Replay storage: Cloudflare R2
- Broadcast origin: Hetzner VPS with nginx-rtmp or MediaMTX

Replay behavior in this mode:

- When the class ends, the backend now snapshots the active HLS playlist and segments into protected replay storage immediately.
- Students can begin replay almost right away from the same protected in-app player.
- The existing MP4 recording / course-publish pipeline can still run afterward as a secondary archival path.

Required env:

```env
POSTGRES_URL=postgresql://postgres.<project-ref>:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
REDIS_URL=rediss://default:PASSWORD@YOUR-REDIS.upstash.io:6379
PRIVATE_VIDEO_STORAGE_PROVIDER=s3
S3_BUCKET=your-r2-bucket
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your_r2_key
S3_SECRET_ACCESS_KEY=your_r2_secret
LIVE_HLS_INTERNAL_BASE_URL=http://mediamtx:8888/hls
LIVE_INGEST_STREAM_BASE_URL=rtmp://live.yourdomain.com:1935/stream
LIVE_INGEST_PUBLISHER_SECRET=replace_with_long_random_secret
VITE_LIVE_HLS_BASE_URL=https://live.yourdomain.com/hls
VITE_LIVE_INGEST_RTMP_URL=rtmp://live.yourdomain.com:1935/stream
```

## Secure ingest callback

Managed HLS ingest can now be validated through:

```text
/backend/api/live-classes/ingest/validate
```

It checks:

- shared ingest secret when `LIVE_INGEST_PUBLISHER_SECRET` is set
- live class exists
- live class is configured for `hls`
- stream key matches the live class route
- class is not cancelled or ended

## OBS publishing

For the managed HLS path, use:

```text
Server: rtmp://live.yourdomain.com:1935/live
Stream Key: <liveClassId>__<courseId>__<moduleId>__<chapterId_or_root>?secret=<LIVE_INGEST_PUBLISHER_SECRET>
```

## Immediate replay notes

Managed HLS replays now work in two layers:

1. Immediate replay
- triggered when the live class is ended
- snapshots the current HLS manifests and media assets into protected storage
- keeps the existing 6-month retention and 2-view backend enforcement

2. Background archival
- the existing recording importer can still convert finalized MP4 recordings into course lessons
- this is slower, but useful for long-term course publishing after the immediate replay is already available

## Release checklist

1. Fill [/.env.production](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/.env.production)
2. Run `npm run validate:production`
3. Run `npm run lint`
4. Start the app server
5. Start the watch worker with `npm run track:worker`
6. If using managed HLS, deploy either:
   - [infra/lowcost/docker-compose.prod.yml](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/docker-compose.prod.yml)
   - [infra/hetzner-nginx-rtmp/nginx.conf](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/hetzner-nginx-rtmp/nginx.conf)
7. If using LiveKit, verify host and viewer tokens work from the admin live-class screen
8. Create a live class from admin and confirm:
   - admin can start
   - student receives notification
   - student can join
   - video/audio stays visible through the teaching window
