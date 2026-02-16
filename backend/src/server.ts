import Fastify from "fastify"
import cors from "@fastify/cors"
import fastifyMultipart from "@fastify/multipart"
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3"
import { s3, BUCKET_NAME } from "./lib/s3.js"
import { runMigrations } from "./lib/migrate.js"
import { checkDatabaseConnection, closeDatabasePool } from "./lib/db.js"
import { checkRedisConnection, closeRedisConnection } from "./lib/redis.js"

// Routes
import { authRoutes } from "./routes/auth.js"
import { userRoutes } from "./routes/users.js"
import { friendRoutes } from "./routes/friends.js"
import { serverRoutes } from "./routes/servers.js"
import { channelRoutes } from "./routes/channels.js"
import { messageRoutes } from "./routes/messages.js"
import { uploadRoutes } from "./routes/uploads.js"
import { miscRoutes } from "./routes/misc.js"
import { statsRoutes } from "./routes/stats.js"
import { notificationRoutes } from "./routes/notifications.js"
import { recordRequest, startMetricsCollector } from "./lib/stats.js"

const app = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB
})

app.addHook("onRequest", (req, _reply, done) => {
  ;(req as any).startTime = process.hrtime()
  done()
})

app.addHook("onResponse", (req, _reply, done) => {
  const startTime = (req as any).startTime
  if (startTime) {
    const diff = process.hrtime(startTime)
    const latencyMs = (diff[0] * 1000) + (diff[1] / 1e6)
    recordRequest(latencyMs)
  }
  done()
})

function getCorsOrigins() {
  return (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

async function ensureStorageBucket() {
  const shouldAutoInit = process.env.S3_AUTO_INIT === "true"
  if (!shouldAutoInit) return

  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))
  } catch {
    app.log.info(`Creating storage bucket: ${BUCKET_NAME}`)
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }))
  }

  if (process.env.S3_SET_LIFECYCLE !== "false") {
    try {
      await s3.send(new PutBucketLifecycleConfigurationCommand({
        Bucket: BUCKET_NAME,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: "DeleteOldFiles",
              Status: "Enabled",
              Filter: { Prefix: "" },
              Expiration: { Days: Number(process.env.S3_RETENTION_DAYS || 180) },
            },
          ],
        },
      }))
    } catch (e) {
      app.log.warn({ err: e }, "Failed to apply bucket lifecycle policy")
    }
  }

  if (process.env.S3_SET_PUBLIC_POLICY !== "false") {
    try {
      const policy = {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadGetObject",
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
          },
        ],
      }
      await s3.send(new PutBucketPolicyCommand({
        Bucket: BUCKET_NAME,
        Policy: JSON.stringify(policy),
      }))
    } catch (e) {
      app.log.warn({ err: e }, "Failed to apply bucket policy")
    }
  }
}

async function registerRoutes() {
  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(friendRoutes)
  await app.register(serverRoutes)
  await app.register(channelRoutes)
  await app.register(messageRoutes)
  await app.register(uploadRoutes)
  await app.register(miscRoutes)
  await app.register(statsRoutes)
  await app.register(notificationRoutes)
}

async function start() {
  const corsOrigins = getCorsOrigins()

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true)
        return
      }
      if (corsOrigins.length === 0 || corsOrigins.includes(origin)) {
        cb(null, true)
        return
      }
      cb(new Error("Origin not allowed"), false)
    },
    credentials: true,
  })

  await app.register(fastifyMultipart)

  await checkDatabaseConnection()
  await checkRedisConnection()
  await ensureStorageBucket()
  await runMigrations()
  startMetricsCollector()

  await registerRoutes()

  const port = Number(process.env.PORT || 4000)
  app.log.info(`Starting API server on 0.0.0.0:${port}`)
  await app.listen({ port, host: "0.0.0.0" })
}

async function shutdown(signal: string) {
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

start().catch((err) => {
  app.log.error(err)
  process.exit(1)
})
