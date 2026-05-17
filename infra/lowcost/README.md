# Hetzner + Cloudflare Low-Cost Live Stack

This is the recommended production stack for EduMaster when:

- cost matters more than ultra-low latency
- one teacher broadcasts to many students
- you want immediate replay after live classes
- you expect up to about `1000` concurrent viewers per class

## Stack

- `Hetzner dedicated server`
  - Node.js app
  - PostgreSQL
  - Redis
  - MediaMTX RTMP + HLS origin
- `Cloudflare proxy/cache`
  - `app.example.com` -> app
  - `live.example.com` -> HLS origin
- `Cloudflare R2`
  - archived protected recordings
- `Hetzner Storage Box`
  - backups

## Files

- [Caddyfile](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/Caddyfile)
- [docker-compose.prod.yml](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/docker-compose.prod.yml)
- [mediamtx.yml](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/mediamtx.yml)
- [.env.hetzner-cloudflare.example](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/.env.hetzner-cloudflare.example)
- [deploy-hetzner.sh](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/deploy-hetzner.sh)
- [backup-to-storage-box.sh](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/backup-to-storage-box.sh)

## Domain layout

- `app.example.com`
  - proxied through Cloudflare
  - serves the app and backend API

- `live.example.com`
  - proxied through Cloudflare
  - serves HLS playback
  - accepts RTMP ingest on port `1935`

## First-time server setup

1. Provision a Hetzner Ubuntu `24.04` server.
2. Install Docker Engine and the Compose plugin.
3. Open ports:
   - `80`
   - `443`
   - `1935`
4. Point `app.example.com` and `live.example.com` at the server.
5. Enable Cloudflare proxy for both hostnames.
6. Copy [/.env.production](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/.env.production) from the example template and fill real values.

## Required env values

At minimum set these in [/.env.production](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/.env.production):

- `APP_DOMAIN`
- `LIVE_DOMAIN`
- `APP_URL`
- `CORS_ORIGIN`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `REPLAY_IMPORT_ADMIN_EMAIL`
- `REPLAY_IMPORT_ADMIN_PASSWORD`
- `JWT_SECRET`
- `PRIVATE_VIDEO_TOKEN_SECRET`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `S3_BUCKET`
- `S3_REGION=auto`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `LIVE_INGEST_PUBLISHER_SECRET`
- `LIVE_HLS_PUBLIC_BASE_URL`

## Deploy

From your local machine:

```bash
chmod +x infra/lowcost/deploy-hetzner.sh
./infra/lowcost/deploy-hetzner.sh root@YOUR_SERVER_IP /opt/edumaster
```

This script:

1. validates the production env
2. builds the frontend locally
3. syncs the repo to the server with `rsync`
4. starts the compose stack remotely

For large classes, the student player should use the public HLS URL directly so the app server stays out of the per-segment media path.

## OBS publish settings

- `Server`: `rtmp://live.example.com:1935/live`
- `Stream Key`: `<liveClassId>__<courseId>__<moduleId>__<chapterId_or_root>`
- `Keyframe interval`: `2`
- `FPS`: `30`
- `Video bitrate`: `2500-3500 kbps`

The first part of the key must be the live class ID. The full key is used for replay import so the recording can be attached back into the correct course/module after the class ends. The shared ingest secret is enforced server-side through the RTMP `on_publish` callback and does not need to be appended to the stream key.

## Real live-class verification

After deployment:

1. log in as admin
2. create an `hls` live class
3. click `Start Live Class`
4. publish from OBS using the generated stream key
5. log in as a student
6. join the same class
7. verify audio/video plays for at least `2-3` minutes
8. end the class
9. open the replay immediately from the student side

## Backup

Run nightly on the server:

```bash
chmod +x infra/lowcost/backup-to-storage-box.sh
STORAGE_BOX_HOST=u123456.your-storagebox.de \
STORAGE_BOX_USER=u123456 \
infra/lowcost/backup-to-storage-box.sh
```

This exports:

- Postgres database dump
- app private uploads
- app upload state

## Important note

I can prepare and validate everything in this repo, but the actual Hetzner deployment and real OBS publish test require:

- a real server IP or SSH target
- the final domain names
- Cloudflare DNS/proxy in place
- R2 credentials
- your filled production env

## Service Details To Share

Do not paste passwords into chat unless you are comfortable doing so. For final deployment, prepare these values in `.env.production` or your hosting secret manager:

- `APP_DOMAIN`, for example `app.varonenglish.com`
- `LIVE_DOMAIN`, for example `live.varonenglish.com`
- Hetzner server IP and SSH target, for example `root@1.2.3.4`
- Cloudflare zone/domain access, or confirmation DNS is pointed and orange-cloud proxied
- Cloudflare R2 bucket name, account ID, endpoint, access key ID, and secret access key
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `JWT_SECRET`
- `PRIVATE_VIDEO_TOKEN_SECRET`
- `LIVE_INGEST_PUBLISHER_SECRET`
- production admin email/password
- replay importer admin email/password, usually the same admin account
