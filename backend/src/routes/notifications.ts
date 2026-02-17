import { FastifyInstance } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { JWT_SECRET } from "../lib/auth.js"

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/api/notifications", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      const r = await pool.query(
        `SELECT n.id::text,
                n.type,
                n.source_id::text AS "sourceId",
                n.source_type AS "sourceType",
                n.channel_id::text AS "channelId",
                n.content,
                n.read,
                n.created_at AS ts,
                c.name AS "channelName",
                c.server_id::text AS "serverId",
                c.type AS "channelType"
         FROM notifications n
         LEFT JOIN channels c ON c.id = n.channel_id
         WHERE n.user_id = $1::uuid
         ORDER BY n.created_at DESC
         LIMIT 100`,
        [payload.sub]
      )
      
      return { notifications: r.rows }
    } catch (e) {
      console.error("GET /api/notifications error:", e)
      return { notifications: [] }
    }
  })

  app.post("/api/notifications/:id/read", async (req: any) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const { id } = req.params
      
      await pool.query(
        `UPDATE notifications SET read = TRUE WHERE id = $1::uuid AND user_id = $2::uuid`,
        [id, payload.sub]
      )
      return { success: true }
    } catch (e) {
      return { error: "Error marking notification as read" }
    }
  })
  
  app.post("/api/notifications/channel/:channelId/read", async (req: any) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const { channelId } = req.params
      
      await pool.query(
        `UPDATE notifications SET read = TRUE WHERE channel_id = $1::uuid AND user_id = $2::uuid`,
        [channelId, payload.sub]
      )
      return { success: true }
    } catch (e) {
      return { error: "Error marking channel notifications as read" }
    }
  })

  app.post("/api/notifications/read-all", async (req: any) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      await pool.query(
        `UPDATE notifications SET read = TRUE WHERE user_id = $1::uuid`,
        [payload.sub]
      )
      return { success: true }
    } catch (e) {
      return { error: "Error marking all as read" }
    }
  })

  app.delete("/api/notifications/:id", async (req: any) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const { id } = req.params
      
      await pool.query(
        `DELETE FROM notifications WHERE id = $1::uuid AND user_id = $2::uuid`,
        [id, payload.sub]
      )
      return { success: true }
    } catch (e) {
      return { error: "Error deleting notification" }
    }
  })
}
