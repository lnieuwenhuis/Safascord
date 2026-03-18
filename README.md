# Safascord

Safascord is a Discord-style community platform with servers, channels, DMs, role-based permissions, realtime updates, and upload support.

## Services

- `frontend/`: React + Vite client
- `backend/`: Fastify REST API
- `realtime/`: WebSocket fanout service
- `infra/`: Docker Compose for local development

## Stack

- Frontend: React 19, TypeScript, Tailwind CSS v4, DaisyUI
- Backend: Fastify, PostgreSQL, Redis, S3-compatible storage
- Realtime: `ws` + Redis pub/sub
- Deployment target: Railway (multi-service)

## Quick Start (Recommended)

### Prerequisites

- Docker + Docker Compose
- Node.js 20+ (for local non-docker workflows)
- Bun 1+ (used in dev Dockerfiles)

### 1) Create `.env` in repo root

Docker compose reads `/.env` for backend defaults. At minimum:

```env
JWT_SECRET=dev_change_me
CORS_ORIGINS=http://localhost,http://localhost:5173
SHOO_BASE_URL=https://shoo.dev
SHOO_ISSUER=https://shoo.dev
SHOO_ALLOWED_ORIGINS=http://localhost,http://localhost:5173
```

If you need a full production-style variable set, start from `railway.env.example`.

### 2) Start the full local stack

```bash
cd infra
docker compose -f docker-compose.dev.yml up --build
```

### 3) Open the app

- App: `http://localhost:5173`
- API health: `http://localhost/api/health`
- API readiness: `http://localhost/api/ready`
- Realtime health: `http://localhost/health`
- Realtime readiness: `http://localhost/ready`

Traefik routes frontend/API/realtime through `http://localhost`.

## Run Services Manually (Optional)

If you prefer running services outside Docker, install deps in each service and run:

```bash
# frontend
cd frontend && npm install && npm run dev

# backend
cd backend && npm install && npm run dev

# realtime
cd realtime && npm install && npm run dev
```

You still need PostgreSQL, Redis, and S3-compatible storage available.

## Deployment

- Single-service setup guide: `DEPLOY_SINGLE_SERVER.md`
- Scaling/multi-service notes: `DEPLOY_MULTI_SERVER.md`
- Rebuild/redeploy checklist: `REBUILD_INSTRUCTIONS.md`
- CI/CD and GitHub automation guide: `CI_CD.md`

## Quality Automation

Install all Node service dependencies:

```bash
npm run install:all
```

Run the full local CI-equivalent suite:

```bash
npm run ci
```

AI pull request review is handled by the installed Qodo GitHub app, with repo-specific guidance in `.pr_agent.toml`.

## Notes

- The repo keeps committed service-specific lockfiles (`bun.lock`) for Docker/Bun-based dev images; when a service `package.json` changes, regenerate and commit that service's `bun.lock`.
- Frontend runtime config lives in `frontend/.env.example`.
