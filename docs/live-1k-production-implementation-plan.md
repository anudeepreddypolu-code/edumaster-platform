# Live Classes 1K Production Implementation Plan

## Goal

Make live classes production-ready for `1,000+` concurrent viewers with:

- smooth playback
- stable join and rejoin
- reliable player transition after `Enter Live Class`
- no Postgres timeouts on live hot paths
- safe admin start and end flows
- working chat, polls, hand raise, screen share, audio, video, fullscreen
- recording start on class start
- recording stop on class end
- replay import into cloud-backed course content after class completion

## Current Truth In This Repo

The platform is not ready for `1k` concurrent live viewers yet.

### Proven blockers

1. Live session state is process-local.
   - [`backend/live/live-session.service.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-session.service.js)
   - Uses `sessions = new Map()` and `streamConnections = new Map()`
   - This breaks multi-instance correctness and restart safety.

2. Postgres is still on critical live paths.
   - [`backend/live/live.controller.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live.controller.js)
   - [`backend/lib/repositories.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/lib/repositories.js)
   - Live start, ingest publish, access, overview, and replay updates still touch DB too directly.

3. The frontend join flow is still too coupled to mutable detail state.
   - [`src/components/LiveClassesFigmaTab.tsx`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/src/components/LiveClassesFigmaTab.tsx)
   - `handleJoinLiveClass`, access refresh, room view, session hydration, and EventSource setup are still too intertwined.

4. Redis exists but is not the primary real-time coordination layer.
   - [`backend/lib/redis.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/lib/redis.js)
   - It currently exposes low-level commands, but live session correctness still depends on process memory.

5. The current DB pool and timeout settings are too small for bursty live traffic if hot paths remain DB-heavy.
   - [`backend/lib/postgres.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/lib/postgres.js)
   - Default `max=20`, `connectionTimeoutMillis=10000`, `statement_timeout=15000`

6. QA automation is useful but not enough yet for final certification.
   - [`qa-automation/src/live-join-smoke.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-join-smoke.ts)
   - [`qa-automation/src/live-load-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-load-review.ts)
   - Current coverage is good for join and basic load, but not yet full mixed-device feature certification.

## Architecture Decision

Use a two-plane live architecture:

1. Control plane
   - admin start/end
   - live class metadata
   - polls
   - hand raise approvals
   - chat moderation
   - recording state

2. Delivery plane
   - viewer access
   - HLS manifest and segment delivery
   - playback readiness
   - presence heartbeat

For `1k+` viewers:

- admin and presenters can stay interactive through LiveKit
- mass viewers should consume HLS playback
- viewer join must not require full room semantics
- viewer access must be cache-first, not DB-first

## Live State Model To Add

Authoritative real-time state must move to Redis.

### Redis key layout

Use keys in this shape:

```text
live:class:{liveClassId}:state
live:class:{liveClassId}:session
live:class:{liveClassId}:participants
live:class:{liveClassId}:participant:{userId}
live:class:{liveClassId}:poll:active
live:class:{liveClassId}:chat:stream
live:class:{liveClassId}:events
live:class:{liveClassId}:recording
live:class:{liveClassId}:replay
live:class:{liveClassId}:presence
live:class:{liveClassId}:metrics
```

### Suggested payloads

`live:class:{id}:state`

```json
{
  "liveClassId": "lc_123",
  "version": 17,
  "status": "playback_ready",
  "deliveryMode": "managed-hls",
  "interactiveMode": "livekit-room",
  "roomName": "edumaster-live-lc_123",
  "playbackUrl": "https://cdn.example.com/live/lc_123/index.m3u8",
  "playbackOriginUrl": "http://mediamtx:8888/live/lc_123/index.m3u8",
  "playbackReadyAt": "2026-05-11T10:00:00.000Z",
  "startedAt": "2026-05-11T09:59:50.000Z",
  "endedAt": null,
  "recordingState": "recording",
  "replayState": "pending",
  "activePresenterId": "admin_1",
  "viewerCount": 0,
  "adminCount": 1
}
```

`live:class:{id}:participant:{userId}`

```json
{
  "userId": "u_1",
  "role": "student",
  "name": "Student 1",
  "joinedAt": "2026-05-11T10:00:10.000Z",
  "lastSeenAt": "2026-05-11T10:05:00.000Z",
  "mode": "viewer",
  "handRaised": false,
  "handStatus": "idle",
  "canSpeak": false,
  "micMuted": true,
  "videoEnabled": false,
  "isScreenSharing": false,
  "removed": false
}
```

`live:class:{id}:recording`

```json
{
  "state": "recording",
  "provider": "cloudflare-r2",
  "startedAt": "2026-05-11T09:59:52.000Z",
  "stoppedAt": null,
  "storagePath": "live-recordings/lc_123/recording.mp4",
  "durationSeconds": null,
  "importJobId": null
}
```

### Redis data structure choice

- live state: JSON string in `SET`
- participants: `SET` or `ZSET` of active user ids plus per-user JSON document
- presence: `SETEX` heartbeat keys with TTL
- event feed: Redis Streams preferred
- chat: Redis Streams preferred
- metrics counters: `HINCRBY`

## Live State Machine Contract

The current lifecycle is too implicit. Replace it with a strict state machine.

### Allowed states

```text
scheduled
starting
ingest_connected
playback_ready
live
ending
ended
recording_processing
replay_ready
failed
```

### Allowed transitions

```text
scheduled -> starting
starting -> ingest_connected
ingest_connected -> playback_ready
playback_ready -> live
live -> ending
ending -> ended
ended -> recording_processing
recording_processing -> replay_ready
any -> failed
```

### Field ownership rules

- `startLiveClass` owns:
  - `status=starting`
  - `startedAt`
  - `roomName`
  - `recordingState=pending`

- ingest publish callback owns:
  - `status=ingest_connected` or `playback_ready`
  - `playbackUrl`
  - `playbackReadyAt`

- viewer join path owns:
  - presence only
  - must not mutate core playback fields

- end flow owns:
  - `status=ending|ended`
  - `endedAt`
  - `recordingState=stopping|processing`

- replay import worker owns:
  - `recordingUrl`
  - `recordingStoragePath`
  - `recordingPublishedAt`
  - `replayCourseId`
  - `replayLessonId`
  - `replayState=replay_ready`

### Race elimination pattern

Every live state write must include:

- `version`
- `updatedAt`
- transition validation

Safe write rule:

```text
update only if current version == expected version
```

If version mismatches:

- reload current Redis state
- re-evaluate transition
- never blindly overwrite playback fields

## Exact Code Refactor Sequence

### Phase 1: Build shared live state layer

#### 1. Add a Redis-backed live state module

Create:

- [`backend/live/live-state.repository.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-state.repository.js)
- [`backend/live/live-state-machine.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-state-machine.js)

Responsibilities:

- read and write live state in Redis
- validate transitions
- maintain version numbers
- publish live events
- maintain recording state

#### 2. Expand Redis utility layer

Refactor:

- [`backend/lib/redis.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/lib/redis.js)

Add helpers for:

- `INCR`
- `EXPIRE`
- `HSET`
- `HGETALL`
- `ZADD`
- `ZRANGE`
- `XADD`
- `XRANGE`
- `PUBLISH`
- `SUBSCRIBE`
- compare-and-set helper through `WATCH/MULTI/EXEC` or Lua

This file is currently too low-level for safe live coordination.

#### 3. Replace in-memory session maps

Refactor:

- [`backend/live/live-session.service.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-session.service.js)

Replace:

- `sessions = new Map()`
- `streamConnections = new Map()`

With:

- Redis-backed session snapshots
- Redis-backed presence
- app-local SSE subscribers only as transport, not source of truth

Keep this service as a thin orchestration layer, not the canonical data store.

### Phase 2: Remove DB from live hot paths

#### 4. Refactor access path

Refactor:

- [`backend/live/live.controller.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live.controller.js)

Spec for `GET /live-classes/:id/access`:

- first read Redis live state
- if no Redis entry, do one DB hydration read, populate Redis, return cached form
- do not query overview or notifications
- do not perform heavy audience derivation
- do not synchronously update attendee analytics in Postgres

Return a small access payload:

```json
{
  "liveClassId": "lc_123",
  "status": "live",
  "accessType": "live-stream",
  "deliveryMode": "managed-hls",
  "interactiveMode": "livekit-room",
  "playbackUrl": "https://cdn.example.com/live/lc_123/index.m3u8",
  "playbackReady": true,
  "sessionSnapshot": {
    "viewerCount": 874,
    "activePoll": null
  }
}
```

#### 5. Refactor join and heartbeat

Refactor:

- [`backend/live/live.controller.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live.controller.js)
- [`backend/live/live-session.service.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-session.service.js)

Rules:

- viewer join writes Redis presence only
- heartbeat refreshes TTL only
- attendee counters update in Redis only
- aggregate to Postgres asynchronously every `30s` to `60s`

#### 6. Isolate overview

Refactor:

- [`backend/lib/repositories.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/lib/repositories.js)
- [`backend/platform/platform.controller.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/platform/platform.controller.js)

Goal:

- live join must not depend on `getOverview()`
- overview remains best-effort and separate
- notifications remain async and fail-soft

### Phase 3: Fix live lifecycle races

#### 7. Refactor admin start

Refactor:

- [`backend/live/live.controller.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live.controller.js)

New start flow:

1. validate class
2. transition Redis state `scheduled -> starting`
3. create deterministic room/session names
4. mark recording `pending`
5. enqueue non-critical work
6. persist durable DB fields asynchronously or in one compact write

Start must never clear an already-known playback URL.

#### 8. Refactor ingest publish callback

Refactor:

- [`backend/live/live.controller.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live.controller.js)

New publish flow:

1. validate secret
2. parse stream name
3. update Redis state first
4. probe manifest readiness if needed
5. transition to `playback_ready`
6. enqueue DB persistence and analytics

This removes the current DB dependency from the most timing-sensitive point.

#### 9. Refactor end flow

Refactor:

- [`backend/live/live.controller.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live.controller.js)

New end flow:

1. transition `live -> ending`
2. stop accepting new joins
3. mark recording `stopping`
4. finalize room/session state
5. transition `ending -> ended`
6. enqueue replay import worker

### Phase 4: Make recording and replay reliable

#### 10. Create background replay pipeline

Use and refactor:

- [`backend/scripts/replay-importer.mjs`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/scripts/replay-importer.mjs)
- [`backend/lib/repositories.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/lib/repositories.js)

Add a worker entry point:

- [`backend/live/live-replay.worker.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-replay.worker.js)

Required pipeline:

1. class starts
2. recording state becomes `recording`
3. class ends
4. recording state becomes `processing`
5. worker imports cloud recording
6. worker creates or updates replay lesson
7. replay state becomes `replay_ready`
8. live class completion screen shows replay link

### Phase 5: Frontend runtime reliability

#### 11. Split detail state from runtime state

Refactor:

- [`src/components/LiveClassesFigmaTab.tsx`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/src/components/LiveClassesFigmaTab.tsx)

Add explicit UI state machine:

```text
list
detail
joining
player_loading
room
reconnecting
ended
replay_ready
error
```

Rules:

- `handleJoinLiveClass` only does access and runtime transition
- session, chat, notes, and poll hydration happen in background
- detail refresh must not mutate runtime selection state
- stale async work must be ignored through a `joinAttemptId`

#### 12. Split watcher mode from interactive mode

In the same file:

- `live-stream` path should render the player immediately
- `livekit-room` path can continue full room setup
- HLS viewers should not wait on room hydration, session join, or EventSource before player render

#### 13. Add defensive runtime guards

Add:

- null-safe helpers for all live metadata
- cancellation guards around access fetch, session fetch, and SSE setup
- runtime instrumentation for:
  - join clicked
  - access resolved
  - player mounted
  - playback started
  - playback failed

## Database Strategy

## Immediate changes

1. Add PgBouncer in front of Postgres.
2. Keep app pool modest, do not just raise it blindly.
3. Reduce live-path queries before raising `Pool.max`.
4. Make live joins presence-only in Redis.

### Recommended app pool starting point after hot-path cleanup

- app instance `Pool.max`: `15` to `25`
- PgBouncer handles high connection fan-in

### Indexes to verify or add

Add migration or schema hardening for:

- `live_classes(status, scheduled_start_at)`
- `live_classes(course_id, status)`
- `live_classes(replay_course_id)`
- `enrollments(user_id, course_id)`
- `enrollments(course_id, user_id)`
- `notifications(user_id, created_at desc)`
- `user_sessions(user_id, status)`
- `video_access_grants(user_id, course_id, lesson_id)`
- `live_replay_access_grants(user_id, live_class_id)`

### Query policy

- live access: Redis first
- live join: Redis only
- live heartbeat: Redis only
- viewer count persistence: async batch
- recording publish metadata: async worker-safe writes

## Caching And Event Distribution Strategy

### Required caches

1. live state cache
2. session snapshot cache
3. access payload cache
4. presenter/media state cache
5. active poll cache

### Event transport

Use Redis pub/sub or Redis Streams for:

- `live.class.started`
- `live.ingest.connected`
- `live.playback.ready`
- `live.session.updated`
- `live.chat.created`
- `live.poll.updated`
- `live.recording.processing`
- `live.replay.ready`

### TTL policy

- viewer presence TTL: `30s`
- access payload cache: `5s`
- session snapshot cache: `2s`
- chat read cursor TTL: `1h`
- recording and replay state: no TTL until cleanup

## Streaming Delivery Optimization

## Delivery target

For `1k+` viewers:

- HLS for viewers
- LiveKit for presenter/admin/interactivity

### Critical change

Do not keep the app tier as the bulk byte pipe for all manifests and segments.

Move to:

- CDN in front of HLS assets
- signed short-lived playback URLs
- app mints or rewrites signed URLs
- media origin remains private

### Playback readiness rule

Do not expose viewer access as ready until:

- manifest exists
- first segment list is reachable
- Redis state says `playback_ready`

## Retry And Backpressure Handling

### Safe retries

Allow bounded retries for:

- ingest readiness check
- recording metadata persistence
- replay import
- notification queue enqueue

Do not aggressively retry:

- viewer access
- viewer heartbeat
- chat send

### Backpressure controls

Add rate limits for:

- poll updates
- hand raise toggle spam
- chat burst spam
- repeated access refresh

Use Redis-backed counters for per-user and per-class limits.

## Monitoring And Alerting

Before production certification, instrument:

### API metrics

- `GET /live-classes/:id/access` p50, p95, p99
- `GET /live-classes/:id/session` p50, p95, p99
- `POST /live-classes/:id/start`
- `POST /live-classes/:id/end`
- ingest callback latency
- chat publish latency
- poll update latency

### DB metrics

- pool waiting count
- connection acquisition latency
- query timeout count
- slow query count
- PgBouncer client wait

### Redis metrics

- command latency
- failed writes
- pub/sub lag
- stream growth
- memory usage

### Player metrics

- join click to player visible
- player startup time
- manifest fetch latency
- rebuffer count
- playback error rate
- reconnect success rate

### Recording metrics

- recording start success
- recording stop success
- recording file availability delay
- replay import duration
- replay publish success

## Automation Expansion Plan

Current scripts:

- [`qa-automation/src/live-join-smoke.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-join-smoke.ts)
- [`qa-automation/src/live-load-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-load-review.ts)
- [`qa-automation/src/live-browser-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-browser-review.ts)

### Add these scripts

1. [`qa-automation/src/live-feature-certification.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-feature-certification.ts)
   - desktop admin
   - desktop student
   - mobile student viewport
   - tablet student viewport
   - takes screenshots at each stage
   - records issues per stage in JSON and markdown

2. [`qa-automation/src/live-soak-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-soak-review.ts)
   - keeps class live for `10`, `30`, or `60` minutes
   - runs periodic rejoin, heartbeat, chat, poll, fullscreen, and view refresh checks

3. [`qa-automation/src/live-recording-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-recording-review.ts)
   - admin starts class
   - verifies recording state becomes active
   - admin ends class
   - waits for recording import
   - verifies replay appears on completed live class

4. Extend [`qa-automation/src/live-load-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-load-review.ts)
   - mixed-device viewer distribution metadata
   - staged join ramp
   - 10-minute steady-state hold
   - admin poll during load
   - controlled rejoin wave

### Certification stages

#### Stage A: single-user correctness

Take screenshots for:

1. live class scheduled card visible
2. admin start visible
3. join button visible
4. join click accepted
5. player visible
6. chat visible
7. poll creation and student receipt
8. hand raise and approval
9. fullscreen/maximize
10. end class state visible
11. replay visible after processing

#### Stage B: small mixed-device run

Run:

- `1` desktop admin
- `2` desktop students
- `2` mobile students
- `1` tablet student

Verify:

- all can join
- no UI crashes
- no stalled player
- chat and polls reflect across clients

#### Stage C: soak

Run:

- `25` viewers for `10` minutes
- `100` viewers for `30` minutes

#### Stage D: scale

Run:

- `300`
- `500`
- `1000`

### Artifact policy

Each run should output:

- screenshots
- HTML dumps
- console logs
- network logs
- issue summary JSON
- markdown report

Store under:

- [`qa-automation/artifacts/`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/artifacts/)
- [`qa-automation/reports/`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/reports/)

## 1K Load Test Design

### Required scenario

One admin starts a live class.

Then:

1. `1000` viewer tokens prepared
2. ramp `1000` users in over `2` to `5` minutes
3. keep them connected for `10` minutes minimum
4. run:
   - access
   - initial player fetch
   - heartbeat
   - session snapshot
5. inject:
   - one poll update
   - one chat burst
   - one reconnect wave of `10%`
6. admin ends class
7. verify viewers observe end state
8. verify replay pipeline starts

### Mixed-device simulation model

Tag virtual users as:

- `65%` mobile web
- `25%` desktop web
- `10%` tablet or laptop high-resolution

This mostly affects:

- request pacing
- viewport automation
- screenshot certification subset

### Minimum pass thresholds

- join success `>= 99.5%`
- access API p95 `<= 200ms`
- session snapshot p95 `<= 250ms`
- zero DB connection timeouts
- player visible p95 `<= 3s`
- replay pipeline starts successfully after end
- no bulk viewer disconnect wave caused by app restart or deploy

## Deployment Hardening

### Required

1. multi-instance app deployment
2. Redis in same region
3. PgBouncer in front of Postgres
4. CDN in front of HLS playback
5. separate worker for replay processing
6. readiness checks for Redis and DB
7. graceful shutdown for SSE and in-flight live requests

### Strongly recommended

1. isolate admin/control APIs from asset delivery
2. rolling deploy with connection draining
3. feature flags for new live-state path
4. emergency degraded-mode switch:
   - keep playback alive
   - temporarily disable chat or hand raise if Redis latency spikes

## Step-By-Step Priority Order

### Priority 0

Do not certify production for `1k` yet.

### Priority 1

Build Redis-backed live state:

- [`backend/lib/redis.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/lib/redis.js)
- [`backend/live/live-state.repository.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-state.repository.js)
- [`backend/live/live-state-machine.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-state-machine.js)
- [`backend/live/live-session.service.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-session.service.js)

### Priority 2

Refactor hot live controller paths:

- [`backend/live/live.controller.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live.controller.js)

Target first:

- access
- start
- ingest publish
- join
- heartbeat
- end

### Priority 3

Decouple live frontend runtime:

- [`src/components/LiveClassesFigmaTab.tsx`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/src/components/LiveClassesFigmaTab.tsx)

### Priority 4

Move recording and replay to worker-backed flow:

- [`backend/scripts/replay-importer.mjs`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/scripts/replay-importer.mjs)
- [`backend/live/live-replay.worker.js`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/backend/live/live-replay.worker.js)

### Priority 5

Expand automation:

- [`qa-automation/src/live-feature-certification.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-feature-certification.ts)
- [`qa-automation/src/live-soak-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-soak-review.ts)
- [`qa-automation/src/live-recording-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-recording-review.ts)
- [`qa-automation/src/live-load-review.ts`](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/qa-automation/src/live-load-review.ts)

### Priority 6

Harden infra:

- PgBouncer
- Redis sizing
- CDN
- worker deployment
- load balancer config

## Production Readiness Gates

Do not call this ready until all of these are true:

1. no Postgres connection timeouts during live start, access, publish, and end
2. no live state loss during app restart or rolling deploy
3. `1000` viewers can join one class successfully
4. player transition is reliable across mobile and desktop
5. chat, polls, hand raise, fullscreen, audio, video, and screen share work in the intended role-specific paths
6. admin can end class cleanly
7. recording starts automatically at class start
8. recording stops automatically at class end
9. replay asset is stored in cloud
10. replay becomes visible on completed live class
11. soak test passes for at least `10` minutes at `1000` viewers, then `30` to `60` minutes before final certification

## Recommended First Implementation Slice

Build this first before touching more UI:

1. Redis live state repository
2. state machine
3. refactor `getLiveClassAccess`
4. refactor ingest publish callback
5. refactor join and heartbeat to Redis presence

This is the smallest slice that removes the most dangerous production risk.
