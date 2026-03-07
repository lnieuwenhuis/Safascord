# Safascord Rust Backend

This workspace contains the in-progress Rust replacement for the existing
TypeScript backend and realtime services.

Crates:
- `core`: shared config, auth, state, helpers
- `api`: Axum HTTP API compatible with `/api/*`
- `realtime`: Axum websocket fanout service compatible with `/ws`
- `contract-tests`: black-box compatibility tests and fixtures

Deployment assets:
- `Dockerfile.api`
- `Dockerfile.realtime`
- `railway.api.json`
- `railway.realtime.json`

Railway deployment:
- Do not set the service Root Directory to `/rust-backend/api` or `/rust-backend/realtime`.
- Railway only uploads files under the selected Root Directory, so those settings exclude the workspace root `Cargo.toml` and the shared `core/` crate.
- Recommended Nixpacks setup:
  - API Root Directory: `/rust-backend`
  - API Railway Config File: `/rust-backend/api/railway.json`
  - Realtime Root Directory: `/rust-backend`
  - Realtime Railway Config File: `/rust-backend/realtime/railway.json`
- Alternative Docker setup from the repo root:
  - API Root Directory: `/`
  - API Railway Config File: `/rust-backend/railway.api.json`
  - Realtime Root Directory: `/`
  - Realtime Railway Config File: `/rust-backend/railway.realtime.json`

The existing `backend/` and `realtime/` TypeScript services remain in the repo
until cutover. This workspace is intended to replace them without changing the
frontend contract.
