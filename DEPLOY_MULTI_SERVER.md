# Multi-Server (Docker Swarm) Deployment Guide

This guide describes how to deploy the application across multiple servers for high availability and horizontal scaling using Docker Swarm.

## Prerequisites

1.  **Multiple Servers**: At least 2 servers (1 Manager, 1+ Workers).
    *   All servers must be on the same private network (low latency).
2.  **Container Registry**: A place to host your built images (Docker Hub, GHCR, or AWS ECR).
    *   *Swarm nodes cannot build images; they must pull them from a registry.*
3.  **Domain Name**: Point your DNS records to the **Manager Node's IP** (or a Load Balancer in front of the swarm).

## Setup Steps

### 1. Initialize Swarm
On the **Manager Node**:
```bash
docker swarm init --advertise-addr <MANAGER_PRIVATE_IP>
```
This command outputs a join token.

### 2. Join Workers
On each **Worker Node**, run the command outputted by the init step:
```bash
docker swarm join --token <TOKEN> <MANAGER_IP>:2377
```

### 3. Label the Manager Node
The database and storage services are pinned to the manager node to ensure they find their data volumes.
```bash
# Run on Manager
docker node update --label-add role=manager <HOSTNAME_OF_MANAGER>
```
*(Note: Docker automatically adds `node.role==manager`, but explicit labeling can be safer if you customize constraints).*

### 4. Build and Push Images
Since Swarm nodes pull images, you must build and push them first.
*   Export your registry URL (e.g., `docker.io/yourusername` or `ghcr.io/yourorg`).

```bash
export DOCKER_REGISTRY=your-registry-url

# Login to registry
docker login

# Build and Push
docker compose -f infra/docker-compose.prod.yml build
docker compose -f infra/docker-compose.prod.yml push
```

### 5. Deploy the Stack
On the **Manager Node**:

1.  **Create .env file**: Copy your `.env` file to the manager node (same variables as Single Server).
2.  **Deploy**:
    ```bash
    # Load env vars and deploy
    export $(cat .env | xargs) && docker stack deploy -c infra/docker-compose.prod.yml discord-stack
    ```

### 6. Verification
Check the status of your stack:
```bash
docker stack services discord-stack
```
You should see `REPLICAS 3/3` for api and realtime services.

Check logs for a specific service:
```bash
docker service logs -f discord-stack_api
```

## Scaling
To scale up the API or Realtime services:
```bash
docker service scale discord-stack_api=5
docker service scale discord-stack_realtime=5
```

## Updates
To deploy a new version:
1.  `git pull` on your build machine.
2.  `docker compose -f infra/docker-compose.prod.yml build && docker compose -f infra/docker-compose.prod.yml push`
3.  On Manager: `docker stack deploy -c infra/docker-compose.prod.yml discord-stack` (Swarm detects changes and performs a rolling update).
