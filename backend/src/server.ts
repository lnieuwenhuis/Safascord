import { closeDatabasePool } from "./lib/db.js"
import { closeRedisConnection } from "./lib/redis.js"
import { startServer } from "./app.js"

let app: Awaited<ReturnType<typeof startServer>> | null = null

async function shutdown(signal: string) {
  if (!app) {
    process.exit(0)
  }
  app.log.info(`Received ${signal}, shutting down`)
  try {
    await app.close()
  } catch (e) {
    app.log.error({ err: e }, "Fastify shutdown failed")
  }
  await Promise.allSettled([closeDatabasePool(), closeRedisConnection()])
  process.exit(0)
}

process.once("SIGTERM", () => { void shutdown("SIGTERM") })
process.once("SIGINT", () => { void shutdown("SIGINT") })

startServer()
  .then((server) => {
    app = server
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
