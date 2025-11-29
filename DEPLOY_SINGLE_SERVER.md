# Single Server Deployment Guide

This guide describes how to deploy the application on a single Linux server (Ubuntu/Debian recommended).

## Prerequisites

1.  **Linux Server**: A VPS or physical server with at least 2GB RAM (4GB+ recommended).
2.  **Domain Name**: Point the following DNS records to your server's IP:
    *   `yourdomain.com` (A Record)
    *   `storage.yourdomain.com` (A Record)
    *   `console.yourdomain.com` (A Record)
3.  **Docker & Docker Compose**:
    ```bash
    # Install Docker
    curl -fsSL https://get.docker.com | sh
    # Verify installation
    docker compose version
    ```

## Deployment Steps

### 1. Clone the Repository
SSH into your server and clone the project:
```bash
git clone https://github.com/yourusername/discord-clone.git
cd discord-clone
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory:
```bash
cp .env.example .env
nano .env
```

**Important Production Variables:**
```ini
# Domain
DOMAIN_NAME=yourdomain.com
ACME_EMAIL=admin@yourdomain.com (For SSL certificates)

# Database
POSTGRES_USER=app
POSTGRES_PASSWORD=secure_password_here
POSTGRES_DB=app

# Redis
REDIS_URL=redis://redis:6379

# MinIO (S3 Storage)
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=secure_minio_password
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=admin
S3_SECRET_KEY=secure_minio_password
S3_BUCKET_NAME=uploads
S3_PUBLIC_URL=https://storage.yourdomain.com

# Auth (WorkOS)
WORKOS_API_KEY=sk_...
WORKOS_CLIENT_ID=client_...
JWT_SECRET=very_long_random_secret_string
```

### 3. Build and Start
Run the production stack using Docker Compose:

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build
```

*   `-d`: Runs in detached mode (background).
*   `--build`: Forces a build of the images from source.

### 4. Verification
Check the status of your containers:
```bash
docker compose -f infra/docker-compose.prod.yml ps
```

View logs if something isn't working:
```bash
docker compose -f infra/docker-compose.prod.yml logs -f
```

### 5. Accessing the App
*   **Frontend**: `https://yourdomain.com`
*   **API**: `https://yourdomain.com/api/health`
*   **MinIO Console**: `https://console.yourdomain.com` (Login with MINIO_ROOT_USER/PASSWORD)

### Maintenance
*   **Update Code**: `git pull && docker compose -f infra/docker-compose.prod.yml up -d --build`
*   **Stop Server**: `docker compose -f infra/docker-compose.prod.yml down`
