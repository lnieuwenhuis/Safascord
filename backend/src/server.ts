import Fastify from "fastify"
import cors from "@fastify/cors"
import fastifyMultipart from "@fastify/multipart"
import { 
  CreateBucketCommand, 
  PutBucketLifecycleConfigurationCommand, 
  PutBucketPolicyCommand, 
  HeadBucketCommand 
} from "@aws-sdk/client-s3"
import { s3, BUCKET_NAME } from "./lib/s3.js"
import { runMigrations } from "./lib/migrate.js"

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
import { recordRequest, startMetricsCollector } from "./lib/stats.js"

const app = Fastify({ 
  logger: true,
  bodyLimit: 50 * 1024 * 1024 // 50MB
})

// Request Latency Tracking
app.addHook('onRequest', (req, reply, done) => {
  (req as any).startTime = process.hrtime()
  done()
})

app.addHook('onResponse', (req, reply, done) => {
  const startTime = (req as any).startTime
  if (startTime) {
    const diff = process.hrtime(startTime)
    const latencyMs = (diff[0] * 1000) + (diff[1] / 1e6)
    recordRequest(latencyMs)
  }
  done()
})

async function start() {
  // Initialize S3 Bucket
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))
  } catch (e) {
    console.log("Creating bucket:", BUCKET_NAME)
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }))
    } catch (err) {
      console.error("Failed to create bucket:", err)
    }
  }

  // Set Lifecycle Policy (6 months retention)
  try {
    await s3.send(new PutBucketLifecycleConfigurationCommand({
      Bucket: BUCKET_NAME,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "DeleteOldFiles",
            Status: "Enabled",
            Filter: { Prefix: "" },
            Expiration: { Days: 180 }
          }
        ]
      }
    }))
  } catch (e) {
    console.error("Failed to set lifecycle policy:", e)
  }

  // Set Public Policy
  try {
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${BUCKET_NAME}/*`
        }
      ]
    }
    await s3.send(new PutBucketPolicyCommand({
      Bucket: BUCKET_NAME,
      Policy: JSON.stringify(policy)
    }))
  } catch (e) {
    console.error("Failed to set bucket policy:", e)
  }

  await app.register(cors, {
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  })
  await app.register(fastifyMultipart)
  
  // Run Migrations
  await runMigrations()
  
  // Start Metrics Collector
  startMetricsCollector()

  // Register Routes
  try {
    await app.register(authRoutes)
    await app.register(userRoutes)
    await app.register(friendRoutes)
    await app.register(serverRoutes)
    await app.register(channelRoutes)
    await app.register(messageRoutes)
    await app.register(uploadRoutes)
    await app.register(miscRoutes)
    await app.register(statsRoutes)
  } catch (err) {
    console.error("Failed to register routes:", err)
    process.exit(1)
  }

  const port = Number(process.env.PORT || 4000)
  try {
    console.log(`Starting server on 0.0.0.0:${port}`)
    await app.listen({ port, host: "0.0.0.0" })
  } catch (err) {
    app.log.error(err)
    console.error("Failed to start server:", err)
    process.exit(1)
  }
}

start().catch(err => {
  console.error("Startup error:", err)
  process.exit(1)
})
