import Redis, { Cluster } from "ioredis"

// Redis Setup (Standalone or Cluster)
let redis: Redis | Cluster
if (process.env.REDIS_CLUSTER_NODES) {
  // Expect comma-separated list: "redis-1:6379,redis-2:6379,..."
  redis = new Redis.Cluster(process.env.REDIS_CLUSTER_NODES.split(","))
} else {
  redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379")
}

redis.on("error", (err) => {
  console.error("Redis connection error:", err)
})

export async function checkRedisConnection() {
  await redis.ping()
}

export async function closeRedisConnection() {
  await redis.quit()
}

export { redis }
