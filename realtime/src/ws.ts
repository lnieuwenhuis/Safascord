import Redis, { Cluster } from "ioredis"
import {
  createRealtimeService,
  readJwtSecret,
  readAllowedOrigins,
} from "./service.js"

function createRedisClients() {
  let sub: Redis | Cluster
  let pub: Redis | Cluster

  if (process.env.REDIS_CLUSTER_NODES) {
    const nodes = process.env.REDIS_CLUSTER_NODES.split(",")
    sub = new Redis.Cluster(nodes)
    pub = new Redis.Cluster(nodes)
  } else {
    const url = process.env.REDIS_URL || "redis://localhost:6379"
    sub = new Redis(url)
    pub = new Redis(url)
  }

  return { sub, pub }
}

const jwtSecret = readJwtSecret()
const { sub, pub } = createRedisClients()
const service = createRealtimeService({
  port: Number(process.env.PORT || 4001),
  allowedOrigins: readAllowedOrigins(),
  jwtSecret,
  sub,
  pub,
})

async function shutdown(signal: string) {
  await service.shutdown(signal)
  process.exit(0)
}

process.once("SIGTERM", () => { void shutdown("SIGTERM") })
process.once("SIGINT", () => { void shutdown("SIGINT") })

service.listen().catch((err) => {
  console.error(err)
  process.exit(1)
})
