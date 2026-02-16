# Railway Deployment Guide (cord.safasfly.dev)

This project is now configured for Railway as a multi-service deployment:
- `frontend` (React/Vite)
- `backend` (Fastify API)
- `realtime` (WebSocket service)
- Railway PostgreSQL plugin
- Railway Redis plugin
- External S3-compatible bucket for uploads

## 1. Create Services on Railway

From the same GitHub repo, create three app services:
1. `frontend` with root directory `frontend/`
2. `backend` with root directory `backend/`
3. `realtime` with root directory `realtime/`

Each service already includes a `railway.json`.

Then add:
1. PostgreSQL plugin service
2. Redis plugin service

## 2. Configure S3-Compatible Storage

Use Cloudflare R2, AWS S3, or another S3-compatible provider.  
Create a bucket for image/file uploads (example: `safascord-uploads`).

## 3. Set Environment Variables

Use `railway.env.example` as your baseline.

Minimum required values:
- Frontend:
  - `VITE_API_BASE=https://api.cord.safasfly.dev/api`
  - `VITE_WS_BASE=wss://ws.cord.safasfly.dev/ws`
- Backend:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `JWT_SECRET`
  - `SHOO_BASE_URL`
  - `SHOO_ISSUER`
  - `SHOO_ALLOWED_ORIGINS`
  - `REALTIME_BASE_HTTP` (private Railway URL for realtime)
  - `REALTIME_BASE_WS=wss://ws.cord.safasfly.dev/ws`
  - `CORS_ORIGINS=https://cord.safasfly.dev`
  - S3 vars (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`)
- Realtime:
  - `REDIS_URL`
  - `WS_ALLOWED_ORIGINS=https://cord.safasfly.dev`

## 4. Attach Custom Domains

Set custom domains:
- Frontend service: `cord.safasfly.dev`
- Backend service: `api.cord.safasfly.dev`
- Realtime service: `ws.cord.safasfly.dev`

Then point DNS CNAMEs to Railway targets for each service.

## 5. Verify Deployment

- Frontend: `https://cord.safasfly.dev`
- API health: `https://api.cord.safasfly.dev/api/health`
- API readiness: `https://api.cord.safasfly.dev/api/ready`
- Realtime health: `https://ws.cord.safasfly.dev/health`
- Realtime readiness: `https://ws.cord.safasfly.dev/ready`

## Notes

- This setup intentionally avoids Docker in production.
- Storage bucket creation/policy is disabled by default in production (`S3_AUTO_INIT=false`).
- If you run MinIO locally, set:
  - `S3_FORCE_PATH_STYLE=true`
  - `S3_AUTO_INIT=true`
