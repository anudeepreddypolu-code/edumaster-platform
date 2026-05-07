# Backend Implementation Notes

## Current backend capabilities

- JWT auth with login, logout, restore-session, and session invalidation
- course catalog and lesson delivery APIs
- mock tests, daily quiz, scoring, and leaderboard flows
- analytics, notifications, engagement, payments, admin, and platform APIs
- live class scheduling, playback access, and chat/doubt threads
- health, readiness, and liveness endpoints

## Runtime behavior

- **Postgres mode** when `POSTGRES_URL` is configured and reachable
- **Mongo mode** when `MONGODB_URI` is configured and reachable
- **Unavailable** when persistent storage is required but missing/down
- **Memory mode** only when explicitly allowed for non-production testing
- No bundled users, courses, tests, quizzes, enrollments, or sample activity are created by the backend

## Important routes

- `/api/auth/*`
- `/api/platform/*`
- `/api/courses/*`
- `/api/tests/*`
- `/api/quiz/*`
- `/api/live-classes/*`
- `/api/analytics/*`
- `/api/admin/*`
- `/api/health`
- `/api/ready`
- `/api/live`

## Production hardening already added

- production config validation for unsafe defaults
- runtime APIs expose only production data workflows
- frontend overview payloads are built from real platform records
- memory fallback blocked in production-safe configs
- deploy-time validation hook for Firebase deployment

## Remaining recommended next steps

1. Move webhook handling to signature-verified Stripe webhook endpoints only.
2. Add request logging and error tracing to a real observability backend.
3. Add DB migrations instead of relying on implicit schema sync paths.
4. Move uploads/replays fully to object storage for durable serverless operation.
5. Add Redis-backed session and leaderboard caching for multi-instance scale.

## Live classes

For production live releases, use:

- [LIVE_CLASSES_RELEASE_GUIDE.md](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/LIVE_CLASSES_RELEASE_GUIDE.md)
- [infra/lowcost/docker-compose.prod.yml](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/lowcost/docker-compose.prod.yml)
- [infra/hetzner-nginx-rtmp/nginx.conf](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/hetzner-nginx-rtmp/nginx.conf)
