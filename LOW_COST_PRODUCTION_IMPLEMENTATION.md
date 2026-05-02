# Lowest-Cost Production Implementation

## Chosen architecture

This repo now defaults to the cheapest viable architecture for your target:

- Live classes: one-to-many RTMP ingest -> MediaMTX -> HLS playback
- Replay: recorded source file -> upload back into app -> private HLS replay -> R2-backed storage
- Daily mock tests: existing Postgres-backed test engine
- Doubts: async text/image doubts first, scheduled doubt class on the same HLS live stack only when needed
- Hosting: single low-cost VPS for app + Postgres + Redis + MediaMTX

This is cheaper than Jitsi or LiveKit for 300 students because only the teacher publishes upstream once, while students consume an HLS stream.

## Why this is the cheapest viable option

### Not Jitsi

Jitsi is open source, but for 300 students it still behaves like a room system and pushes live traffic through SFU infrastructure for every viewer. That increases live bandwidth and operational overhead.

### Not LiveKit

LiveKit is excellent technically, but its cloud pricing is usage-based. For a cost-first system with predictable daily classes, one-way HLS is cheaper.

### Why MediaMTX

MediaMTX is open source, light, and can handle:

- RTMP ingest from OBS or FFmpeg
- HLS output for students
- server-side recording to disk

Your app already supports protected HLS playback and replay upload, so MediaMTX fits with minimal extra moving parts.

## Capacity assumptions

- 300 enrolled students
- 2 hours live teaching per day
- average concurrent live viewers: 220
- peak concurrent live viewers: 300
- average live bitrate to student: 1.2 Mbps
- live stream profile: 720p single rendition for live
- replay profile: 480p + 720p HLS

## Bandwidth math

### Live delivery

At 1.2 Mbps per viewer:

- 300 viewers peak = 360 Mbps outbound
- with protocol overhead and spikes, budget ~450 Mbps

That fits within a 1 Gbps VPS port.

Monthly live transfer estimate:

- 1.2 Mbps = 0.54 GB/hour/viewer
- 2 hours/day = 1.08 GB/day/viewer
- 30 days = 32.4 GB/month/viewer
- 300 viewers = 9,720 GB/month

## Storage math

Replay is stored in 2 renditions only.

Using the configured backend replay ladder:

- 480p video ~900 kbps
- 720p video ~2200 kbps
- total stored ladder ~3100 kbps plus audio overhead

Rounded storage per replay hour:

- about 1.5 GB/hour total for both renditions

For 6 months:

- 2 hours/day x 180 days = 360 class hours
- 360 x 1.5 GB = about 540 GB replay storage

## Recommended server

Use one low-cost APAC-friendly VPS first:

- OVHcloud VPS with 1 Gbps traffic-inclusive networking
- keep app, Postgres, Redis, and MediaMTX on the same server

This is cheaper than splitting services too early.

## Monthly cost estimate

### Option used

- 1 x VPS origin server for app + DB + Redis + MediaMTX
- Cloudflare R2 for replay storage

### Monthly estimate

1. Compute:
Approx. $12.75 to $19.97 per month for a traffic-inclusive VPS tier that can safely host app + DB + Redis + MediaMTX for 300 one-way viewers.

2. Replay storage:
About 540 GB at $0.015/GB-month = about $8.10/month when the full 6-month library has accumulated.

3. Replay operations:
Estimate $1 to $5/month depending on watch activity and HLS segment request volume.

4. Domains / SSL:
$0 to $2/month equivalent if annualized. Caddy handles TLS automatically.

### Total monthly run rate

- early months: about $16 to $24/month
- after replay library builds up: about $22 to $35/month

This keeps replay egress near zero-cost on R2 and keeps the expensive live traffic on a single included-bandwidth VPS.

## Aggressive cost cuts

1. Keep live stream single-rendition 720p only.

2. Keep replay renditions to `480p,720p` only.

3. Keep `VIDEO_KEEP_SOURCE_AFTER_PROCESSING=false`.

4. Do not run video rooms for doubt sessions by default.

5. Use async text/image/audio doubts inside the app and bundle only one daily doubt-live batch on the same HLS infra.

6. Keep Postgres and Redis on the same machine until you exceed 1000 active users.

7. Avoid managed video SaaS entirely.

## Live classes implementation

### Teacher workflow

1. Admin schedules class in the app.
2. Select `Lowest-cost HLS broadcast`.
3. Save class.
4. Start class in admin panel.
5. Publish from OBS or FFmpeg to:

```text
rtmp://live.varonenglish.com:1935/stream/<liveClassId>__<courseId>__<moduleId>__<chapterId_or_root>
```

### Student workflow

1. Student opens Live Classes inside the app.
2. Backend issues protected playback token.
3. App plays HLS via in-app player.

Students do not need YouTube, Vimeo, or external video apps.

## Replay pipeline

1. MediaMTX records the live source to `/recordings/<streamKey>/...mp4`.
2. `replay-importer` sidecar scans the recordings folder.
3. It uploads the recorded file to the existing admin course video upload API.
4. Your backend stores the file in S3-compatible private storage.
5. Backend transcodes replay to HLS 480p and 720p.
6. Backend deletes original source after HLS processing.
7. Live class replay is attached back to the relevant live class and course path.
8. Students rewatch unlimited times through the same in-app protected player.

## Mock test system

Use the existing schema in [DB_SCHEMA.sql](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/DB_SCHEMA.sql:114):

- `test_series`
- `tests`
- `questions`
- `test_attempts`
- `daily_quizzes`
- `daily_quiz_attempts`

### Cheapest design

- keep tests as JSON + relational metadata in Postgres
- auto-evaluate on submit in the backend
- no separate queue system needed at this scale
- daily quiz generation can be done as one scheduled insert job per day

### Hosting

Use the same app server and Postgres instance.

## Doubt classes

Cheapest approach:

1. Default doubts to async text + screenshot.
2. Faculty answers inside admin.
3. Escalate unresolved doubts into one daily doubt-live batch using the same HLS live infra.

This is cheaper than running continuous parallel live doubt rooms.

## Infra diagram

```text
Teacher OBS/FFmpeg
    |
    v
RTMP ingest :1935
MediaMTX on VPS
    |                \
    |                 \-> local recording files -> replay-importer -> app API upload -> private storage -> HLS replay
    v
HLS live origin
    |
    v
Node/Express app protected proxy
    |
    v
Students in web app

Same VPS:
- Node app
- Postgres
- Redis
- MediaMTX
- Caddy

Object storage:
- Cloudflare R2 for replay objects
```

## Deployment

### Files

- [infra/lowcost/docker-compose.prod.yml](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/docker-compose.prod.yml:1)
- [infra/lowcost/mediamtx.yml](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/mediamtx.yml:1)
- [infra/lowcost/Caddyfile](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/Caddyfile:1)
- [backend/scripts/import-live-recording.mjs](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/scripts/import-live-recording.mjs:1)
- [backend/scripts/replay-importer.mjs](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/scripts/replay-importer.mjs:1)

### Step-by-step

1. Provision one VPS with Docker and Docker Compose plugin.

2. Point DNS:
- `varonenglish.com` -> VPS public IP
- `live.varonenglish.com` -> VPS public IP

3. Fill [.env.production](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/.env.production:1)

4. Start stack:

```bash
cd infra/lowcost
docker compose -f docker-compose.prod.yml up -d --build
```

5. Seed admin account and tests.

6. In admin UI, create live class with course + subject chosen.

7. Start the live class.

8. Publish from OBS/FFmpeg using the generated stream key.

### FFmpeg publish example

```bash
ffmpeg -re -i class.mp4 \
  -c:v libx264 -preset veryfast -b:v 1200k -maxrate 1200k -bufsize 2400k \
  -c:a aac -b:a 128k -ar 48000 \
  -f flv rtmp://live.varonenglish.com:1935/stream/<streamKey>
```

## Scaling plan to 1000+

### Up to 1000 viewers

Keep the same architecture and scale only the live origin layer:

1. Move app + Postgres + Redis to one VPS.
2. Move MediaMTX to a separate 2 Gbps or dual-origin setup.
3. Add a second HLS edge if outbound traffic exceeds one port.
4. Keep replay on R2.

### Cheapest 1000+ path

- 1 small app/database server
- 2 HLS origin/edge servers
- same replay storage

Do not move to managed video SaaS unless operations time becomes more expensive than infrastructure.
