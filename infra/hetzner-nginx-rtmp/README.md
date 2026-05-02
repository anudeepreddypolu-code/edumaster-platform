# Hetzner nginx-rtmp Stack

This folder contains an ultra-low-cost RTMP ingest + HLS origin example for a Hetzner or DigitalOcean Ubuntu VPS.

Files:

- [nginx.conf](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/hetzner-nginx-rtmp/nginx.conf)
- [r2-sync.sh](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/hetzner-nginx-rtmp/r2-sync.sh)

## What it does

1. Accepts RTMP from OBS on port `1935`
2. Calls the app ingest validator before accepting publish
3. Transcodes into low-cost `720p` and `480p`
4. Writes HLS playlists and `.ts` segments into `/var/www/hls`
5. Optionally syncs the HLS directory to Cloudflare R2
6. Works with the app's immediate replay finalizer so ended live classes can become replayable without waiting for a full MP4 processing cycle

## Important note

For the cheapest student delivery at 1k students, serve live HLS from Cloudflare CDN/R2 or a CDN in front of this VPS. Do not point 1k students directly at the app backend.

For replay storage, Cloudflare R2 is a strong fit.

For the fastest replay turnaround, keep the HLS origin available until the app snapshots the ended class into protected replay storage.

For fully interactive student audio/video, use LiveKit instead of nginx-rtmp.

## App integration

Set `LIVE_HLS_INTERNAL_BASE_URL` to the URL where the app can fetch HLS manifests, for example:

- `http://127.0.0.1:8080/hls` when the app backend runs on the same VPS
- `https://live.example.com/hls` when serving from this nginx origin
- `https://cdn.example.com/live-hls` when Cloudflare fronts the R2 prefix used by [r2-sync.sh](/Users/anudeepreddypolu/Downloads/remix_-edumaster_-ssc-&-rrb-je-prep-platform/infra/hetzner-nginx-rtmp/r2-sync.sh)

The OBS stream key should be the app live class ID. The `on_publish` callback validates the shared `LIVE_INGEST_PUBLISHER_SECRET` and automatically marks that live class as running.
