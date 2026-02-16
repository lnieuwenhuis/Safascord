# Railway Scaling Guide

This replaces the old Docker Swarm flow.

## Service Topology

- `frontend` service (public): serves web UI
- `backend` service (public): REST API (`/api/*`)
- `realtime` service (public): WebSocket endpoint (`/ws`)
- PostgreSQL plugin (private)
- Redis plugin (private)
- S3-compatible object storage (external)

## Horizontal Scaling

Railway supports scaling each service independently:
- Increase `backend` replicas when API latency rises.
- Increase `realtime` replicas when websocket concurrency rises.
- Keep `frontend` at 1+ replicas based on traffic.

Because realtime fanout is Redis-backed, websocket events continue to work across multiple realtime replicas.

## Recommended Production Settings

- Backend:
  - `PG_POOL_MAX=20` (adjust based on DB limits)
  - `CORS_ORIGINS=https://cord.safasfly.dev`
  - `SHOO_BASE_URL=https://shoo.dev`
  - `SHOO_ISSUER=https://shoo.dev`
  - `ENABLE_DEBUG_ROUTES=false`
- Realtime:
  - `WS_ALLOWED_ORIGINS=https://cord.safasfly.dev`
- Storage:
  - `S3_AUTO_INIT=false`
  - `S3_SET_PUBLIC_POLICY=false`
  - `S3_SET_LIFECYCLE=false`

## Health Checks

- Backend readiness endpoint: `/api/ready`
- Realtime readiness endpoint: `/ready`

Use Railway health checks against these endpoints for auto-restart and rollout safety.

## Zero-Downtime Rollout Checklist

1. Deploy `realtime` first.
2. Deploy `backend`.
3. Deploy `frontend`.
4. Confirm:
   - New message send/receive works in at least two browser clients.
   - Attachments upload and render correctly.
   - DM notifications arrive in realtime.
