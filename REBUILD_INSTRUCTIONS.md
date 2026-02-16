# Railway Rebuild / Redeploy

Use this when you need a clean rebuild after major UI/backend changes.

## Redeploy a Single Service

In Railway:
1. Open the service (`frontend`, `backend`, or `realtime`)
2. Click `Deployments`
3. Trigger `Redeploy` (or `Redeploy from latest commit`)

## Force a Fresh Build

If cached layers are causing stale output:
1. Push a no-op commit touching the target service folder
2. Redeploy that service

Example:
```bash
git commit --allow-empty -m "force: railway rebuild frontend"
git push
```

## Verify After Redeploy

- Frontend: `https://cord.safasfly.dev`
- API health: `https://api.cord.safasfly.dev/api/health`
- API readiness: `https://api.cord.safasfly.dev/api/ready`
- Realtime health: `https://ws.cord.safasfly.dev/health`

## Local Dev (Optional)

Docker files still exist for local development only.  
Production deployment path is Railway.
