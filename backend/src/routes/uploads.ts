import { FastifyInstance } from "fastify"
import path from "path"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { s3, BUCKET_NAME, STORAGE_PUBLIC_URL } from "../lib/s3.js"

export async function uploadRoutes(app: FastifyInstance) {
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
      const url = `${STORAGE_PUBLIC_URL}/${BUCKET_NAME}/${name}`
      return { url }
    } catch (e) {
      console.error("Upload failed:", e)
      return { error: "Upload failed" }
    }
  })
}
