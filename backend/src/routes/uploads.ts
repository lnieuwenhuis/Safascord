import { FastifyInstance } from "fastify"
import path from "path"
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3"
import { s3, BUCKET_NAME, STORAGE_PUBLIC_URL } from "../lib/s3.js"
import { Readable } from "stream"
import { pool } from "../lib/db.js"

type ObjectType = {
  Key: string;
  LastModified: Date;
}

async function cleanupStorage() {
  try {
    console.log("Starting storage cleanup...")
    // 1. List all objects
    let objects: ObjectType[] = []
    let continuationToken: string | undefined
    
    do {
       const res = await s3.send(new ListObjectsV2Command({ 
         Bucket: BUCKET_NAME, 
         ContinuationToken: continuationToken 
       }))
       if (res.Contents) {
         const validObjects = res.Contents
           .filter((o: any) => o.Key && o.LastModified)
           .map((o: any) => ({ Key: o.Key!, LastModified: o.LastModified! }))
         objects.push(...validObjects)
       }
       continuationToken = res.NextContinuationToken
    } while (continuationToken)
    
    if (objects.length === 0) return

    // 2. Get all used files from DB
    // We need to match the Key. The DB stores full URLs.
    // Assuming the URL format contains the Key at the end.
    
    const queries = [
      `SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL`,
      `SELECT banner_url FROM users WHERE banner_url IS NOT NULL`,
      `SELECT custom_background_url FROM users WHERE custom_background_url IS NOT NULL`,
      `SELECT icon_url FROM servers WHERE icon_url IS NOT NULL`,
      `SELECT banner_url FROM servers WHERE banner_url IS NOT NULL`,
      `SELECT attachment_url FROM messages WHERE attachment_url IS NOT NULL`
    ]
    
    const usedKeys = new Set<string>()
    
    for (const q of queries) {
       const res = await pool.query(q)
       for (const row of res.rows) {
          const url = Object.values(row)[0] as string
          if (url) {
             // Extract key from URL
             // URL formats: 
             // https://storage.domain.com/bucket/KEY
             // https://domain.com/api/uploads/KEY
             const parts = url.split('/')
             const key = parts[parts.length - 1]
             if (key) usedKeys.add(key)
          }
       }
    }
    
    // 3. Identify orphans
    const orphans = objects.filter(o => !usedKeys.has(o.Key))
    
    // 4. Sort by oldest first
    orphans.sort((a, b) => a.LastModified.getTime() - b.LastModified.getTime())
    
    // 5. Delete
    // Delete in batches of 1000
    const toDelete = orphans.map(o => ({ Key: o.Key }))
    
    if (toDelete.length > 0) {
       console.log(`Found ${toDelete.length} orphaned files. Deleting...`)
       for (let i = 0; i < toDelete.length; i += 1000) {
          const batch = toDelete.slice(i, i + 1000)
          await s3.send(new DeleteObjectsCommand({
             Bucket: BUCKET_NAME,
             Delete: { Objects: batch }
          }))
       }
       console.log("Cleanup complete.")
    } else {
       console.log("No orphaned files found.")
    }

  } catch (e) {
    console.error("Cleanup error:", e)
  }
}

export async function uploadRoutes(app: FastifyInstance) {
  // Run cleanup once on startup (optional, but good for testing)
  // cleanupStorage()

  app.get("/api/uploads/:key", async (req, reply) => {
     const { key } = req.params as { key: string }
     try {
        const command = new GetObjectCommand({
           Bucket: BUCKET_NAME,
           Key: key
        })
        const response = await s3.send(command)
        
        if (response.ContentType) {
           reply.header("Content-Type", response.ContentType)
        }
        reply.header("Cache-Control", "public, max-age=31536000")
        
        return reply.send(response.Body as Readable)
     } catch (e) {
        return reply.status(404).send("Not found")
     }
  })

  app.post("/api/upload", async (req, reply) => {
    const data = await req.file()
    if (!data) return { error: "No file" }
    const ext = path.extname(data.filename)
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
    
    // Limit 50MB
    const buffer = await data.toBuffer()
    if (buffer.length > 50 * 1024 * 1024) return { error: "File too large (max 50MB)" }
  
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: name,
        Body: buffer,
        ContentType: data.mimetype
      }))
      // Use proxy URL if configured, otherwise default
      const publicBaseOverride = process.env.S3_PUBLIC_BASE_URL || ""
      const baseUrl = process.env.PROXY_UPLOADS === "true" 
         ? `${process.env.API_URL || ""}/api/uploads`
         : (publicBaseOverride || `${STORAGE_PUBLIC_URL.replace(/\/$/, "")}/${BUCKET_NAME}`)
         
      const url = `${baseUrl}/${name}`
      return { url }
    } catch (e) {
      console.error("Upload failed:", e)
      // Try cleanup and retry?
      // Only if error indicates storage full, but MinIO might return generic 500.
      // For now, we can trigger cleanup asynchronously on failure to help next time.
      cleanupStorage().catch(console.error)
      
      return { error: "Upload failed" }
    }
  })
}
