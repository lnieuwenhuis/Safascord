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

Railway subdirectory deploys:
- Set API Root Directory to `/rust-backend/api`
- Set realtime Root Directory to `/rust-backend/realtime`
- Each folder now contains its own `railway.json`
- These use Cargo/Nixpacks directly from the service subdirectory instead of the older repo-root Dockerfiles

The existing `backend/` and `realtime/` TypeScript services remain in the repo
until cutover. This workspace is intended to replace them without changing the
frontend contract.
