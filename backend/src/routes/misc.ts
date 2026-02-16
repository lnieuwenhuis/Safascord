import { FastifyInstance } from "fastify"
import { pool } from "../lib/db.js"
import { HeadBucketCommand, ListObjectsV2Command, ListBucketsCommand, GetBucketPolicyCommand } from "@aws-sdk/client-s3"
import { s3, BUCKET_NAME } from "../lib/s3.js"
import { checkDatabaseConnection } from "../lib/db.js"
import { checkRedisConnection } from "../lib/redis.js"

export async function miscRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({
    ok: true,
    service: "api",
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  }))

  app.get("/api/ready", async (_req, reply) => {
    const checks = {
      database: false,
      redis: false,
      storage: false,
      realtime: false,
    }

    try {
      await checkDatabaseConnection()
      checks.database = true
    } catch (e) {
      app.log.error({ err: e }, "Readiness check failed for database")
    }

    try {
      await checkRedisConnection()
      checks.redis = true
    } catch (e) {
      app.log.error({ err: e }, "Readiness check failed for redis")
    }

    try {
      await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))
      checks.storage = true
    } catch (e) {
      app.log.error({ err: e }, "Readiness check failed for storage")
    }

    try {
      const realtimeBase = process.env.REALTIME_BASE_HTTP || "http://localhost:4001"
      const res = await fetch(`${realtimeBase}/health`)
      checks.realtime = res.ok
    } catch (e) {
      app.log.error({ err: e }, "Readiness check failed for realtime")
    }

    const ok = Object.values(checks).every(Boolean)
    if (!ok) reply.status(503)
    return { ok, checks, ts: new Date().toISOString() }
  })

  const debugEnabled = process.env.ENABLE_DEBUG_ROUTES === "true"
  if (!debugEnabled) return

  app.get("/api/debug/s3", async () => {
    try {
      const buckets = await s3.send(new ListBucketsCommand({}))
      let objects: any[] = []
      let policy = null
      try {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME }))
        objects = res.Contents || []
      } catch (e) { console.error("S3 ListObjects error:", e) }
      
      try {
         const p = await s3.send(new GetBucketPolicyCommand({ Bucket: BUCKET_NAME }))
         policy = p.Policy ? JSON.parse(p.Policy) : null
      } catch (e) { console.error("S3 Policy error:", e) }

      return { 
        bucketName: BUCKET_NAME,
        buckets: buckets.Buckets, 
        objects,
        policy
      }
    } catch (e) {
      return { error: String(e) }
    }
  })

  app.get("/api/debug/db", async () => {
    try {
      const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
      // Use try-catch for users query in case table doesn't exist
      let users = { rows: [] }
      try {
        users = await pool.query(`SELECT * FROM users LIMIT 5`)
      } catch (e) { console.error("Error querying users:", e) }
      
      const usersCols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users'`)
      return { 
        tables: tables.rows, 
        users: users.rows,
        userColumns: usersCols.rows
      }
    } catch (e) {
      return { error: String(e) }
    }
  })

  app.post("/api/debug/migrate", async () => {
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`)
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_color TEXT DEFAULT '#000000';`)
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;`)
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`)
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'online';`)
      await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS description TEXT;`)
      await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS icon_url TEXT;`)
      await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS banner_url TEXT;`)
      return { ok: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  app.delete("/api/debug/seed-data", async () => {
     try {
       await pool.query("DELETE FROM friendships")
       await pool.query("DELETE FROM channels WHERE type='dm'")
       return { ok: true }
     } catch (e) {
       return { error: String(e) }
     }
  })
}
