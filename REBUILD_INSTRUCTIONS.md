# Manual Rebuild Instructions

If you need to rebuild the containers (for example, to apply frontend changes that aren't hot-reloading, or to clear the cache), follow these steps.

## Prerequisites

- Ensure you have Docker Desktop installed and running.
- Open a terminal (PowerShell, Command Prompt, or Git Bash).

## Navigate to the Infrastructure Directory

All Docker commands should be run from the `infra` directory.

```powershell
cd infra
```

## Development Environment

We use `docker-compose.dev.yml` for local development.

### Rebuild Frontend Without Cache

To rebuild just the frontend container without using the cache:

```powershell
# 1. Build the frontend image without cache
docker-compose -f docker-compose.dev.yml build --no-cache frontend

# 2. Restart the frontend container (detached mode)
docker-compose -f docker-compose.dev.yml up -d frontend
```

### Rebuild All Services

To rebuild everything (frontend, backend, database, proxy, etc.):

```powershell
# 1. Build all services without cache
docker-compose -f docker-compose.dev.yml build --no-cache

# 2. Restart all services
docker-compose -f docker-compose.dev.yml up -d
```

## Production Environment

For production, use `docker-compose.prod.yml`:

```powershell
# Build and start production services
docker-compose -f docker-compose.prod.yml up -d --build
```

## View Logs

To check if everything is running correctly:

```powershell
# View logs for all services
docker-compose -f docker-compose.dev.yml logs -f

# View logs for just the frontend
docker-compose -f docker-compose.dev.yml logs -f frontend
```
