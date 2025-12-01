import { FastifyInstance } from "fastify"
import path from "path"
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { s3, BUCKET_NAME, STORAGE_PUBLIC_URL } from "../lib/s3.js"
import { Readable } from "stream"

export async function uploadRoutes(app: FastifyInstance) {
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
      const baseUrl = process.env.PROXY_UPLOADS === "true" 
         ? `${process.env.API_URL || ""}/api/uploads`
         : `${STORAGE_PUBLIC_URL}/${BUCKET_NAME}`
         
      const url = `${baseUrl}/${name}`
      return { url }
    } catch (e) {
      console.error("Upload failed:", e)
      return { error: "Upload failed" }
    }
  })
}
