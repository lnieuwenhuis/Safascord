import { FastifyInstance, FastifyRequest } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { redis } from "../lib/redis.js"
import { JWT_SECRET } from "../lib/auth.js"

export async function messageRoutes(app: FastifyInstance) {
  app.get("/api/messages", async (req: FastifyRequest<{ Querystring: { channel?: string; limit?: string; before?: string; serverId?: string } }>) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const channel = req.query.channel
      const serverId = req.query.serverId
      const limit = Math.min(Math.max(parseInt(req.query.limit || "50"), 1), 200)
      const before = req.query.before || null
      
      // Check if channel param is UUID
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channel || "")
      
      let channelId = channel
      if (!isUUID && channel) {
         // Lookup by name (legacy support for server channels by name)
         if (serverId) {
            const c = await pool.query(`SELECT id FROM channels WHERE name=$1::text AND server_id=$2::uuid LIMIT 1`, [channel, serverId])
            channelId = c.rows[0]?.id
         } else {
            const c = await pool.query(`SELECT id FROM channels WHERE name=$1::text LIMIT 1`, [channel])
            channelId = c.rows[0]?.id
         }
      }
      
      if (!channelId) return { messages: [] }
      
      // Verify access
      const c = await pool.query(`SELECT server_id, type FROM channels WHERE id=$1::uuid`, [channelId])
      if (!c.rowCount) return { messages: [] }
      
      if (c.rows[0].type === 'dm') {
          const m = await pool.query(`SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, [channelId, payload.sub])
          if (!m.rowCount) return { error: "Unauthorized" }
      } else {
          // Check view permissions
          const hasPerms = await pool.query(`SELECT 1 FROM channel_permissions WHERE channel_id=$1::uuid LIMIT 1`, [channelId])
          if (hasPerms.rowCount && hasPerms.rowCount > 0) {
             const perms = await pool.query(
               `SELECT cp.can_view
                FROM channel_permissions cp
                JOIN server_member_roles smr ON smr.role_id = cp.role_id
                WHERE cp.channel_id = $1::uuid 
                  AND smr.user_id = $2::uuid
                  AND smr.server_id = $3::uuid`,
               [channelId, payload.sub, c.rows[0].server_id]
             )
             const canView = perms.rows.some(r => r.can_view)
             const serv = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [c.rows[0].server_id])
             const isOwner = serv.rows[0]?.owner_id === payload.sub
             
             if (!canView && !isOwner) return { error: "Unauthorized" }
          }
      }

      const r = await pool.query(
        `SELECT messages.id::text AS id, 
                COALESCE(users.display_name, users.username) AS user, 
                users.avatar_url AS user_avatar,
                users.id::text AS user_id,
                messages.content AS text,
                messages.attachment_url,
                messages.created_at AS ts,
                user_role.color AS role_color
         FROM messages
         JOIN channels ON channels.id = messages.channel_id
         LEFT JOIN users ON users.id = messages.user_id
         LEFT JOIN LATERAL (
            SELECT r.color 
            FROM server_member_roles smr
            JOIN roles r ON r.id = smr.role_id
            WHERE smr.user_id = messages.user_id AND smr.server_id = channels.server_id
            ORDER BY r.position ASC
            LIMIT 1
         ) AS user_role ON true
         WHERE messages.channel_id = $1::uuid
           AND ($2::timestamptz IS NULL OR messages.created_at < $2::timestamptz)
         ORDER BY messages.created_at DESC
         LIMIT $3`,
        [channelId, before, limit]
      )
      const rows = r.rows as { id: string; user: string | null; user_avatar: string | null; user_id: string | null; text: string; attachment_url: string | null; ts: string; role_color: string | null }[]
      return { messages: rows.reverse().map(m => ({ id: m.id, user: m.user ?? "User", userAvatar: m.user_avatar, userId: m.user_id, text: m.text, attachmentUrl: m.attachment_url || undefined, ts: m.ts, roleColor: m.role_color || undefined })) }
    } catch (e) {
      console.error("GET /api/messages error:", e)
      return { messages: [] }
    }
  })

  app.post("/api/messages", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const { channel, content, serverId, attachmentUrl } = body || {}
    if (!auth || !channel || (!content && !attachmentUrl)) return { error: "Bad request" }
    if (content && content.length > 5000) return { error: "Message too long (max 5000 characters)" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      let channelId = channel
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channel)
      
      if (!isUUID) {
         if (serverId) {
            const c = await pool.query(`SELECT id FROM channels WHERE name=$1::text AND server_id=$2::uuid LIMIT 1`, [channel, serverId])
            if (!c.rowCount) return { error: "Channel not found" }
            channelId = c.rows[0].id
         } else {
            const c = await pool.query(`SELECT id FROM channels WHERE name=$1::text LIMIT 1`, [channel])
            if (!c.rowCount) return { error: "Channel not found" }
            channelId = c.rows[0].id
         }
      }
      
      const c = await pool.query(`SELECT server_id, type FROM channels WHERE id=$1::uuid`, [channelId])
      if (!c.rowCount) return { error: "Channel not found" }
      
      if (c.rows[0].type === 'dm') {
         const m = await pool.query(`SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, [channelId, payload.sub])
         if (!m.rowCount) return { error: "Not a member of this DM" }
      } else {
         const s = await pool.query(`SELECT muted FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [c.rows[0].server_id, payload.sub])
         if (!s.rowCount) return { error: "Not a member of this server" }
         if (s.rows[0].muted) return { error: "You are muted" }
         
         // Check channel permissions
         const perms = await pool.query(
           `SELECT cp.can_send_messages 
            FROM channel_permissions cp
            JOIN server_member_roles smr ON smr.role_id = cp.role_id
            WHERE cp.channel_id = $1::uuid 
              AND smr.user_id = $2::uuid
              AND smr.server_id = $3::uuid`,
           [channelId, payload.sub, c.rows[0].server_id]
         )
         
         // If permissions exist, user must have at least one allowed role
         const hasPerms = await pool.query(`SELECT 1 FROM channel_permissions WHERE channel_id=$1::uuid LIMIT 1`, [channelId])
         if (hasPerms.rowCount && hasPerms.rowCount > 0) {
            // User can send if ANY of their roles allow it (Logical OR)
            const canSend = perms.rows.some(r => r.can_send_messages)
            
            // Check if owner
            const serv = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [c.rows[0].server_id])
            const isOwner = serv.rows[0]?.owner_id === payload.sub
            
            // Check if admin
            const admin = await pool.query(
               `SELECT 1 FROM server_member_roles smr
                JOIN roles r ON r.id = smr.role_id
                WHERE smr.user_id = $1::uuid AND smr.server_id = $2::uuid
                  AND (r.can_manage_server = TRUE OR r.can_manage_channels = TRUE)`,
               [payload.sub, c.rows[0].server_id]
            )
            const isAdmin = admin.rowCount && admin.rowCount > 0
            
            if (!canSend && !isOwner && !isAdmin) return { error: "Missing permissions" }
         }
      }

      const r = await pool.query(
        `INSERT INTO messages (channel_id, user_id, content, attachment_url)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::text)
         RETURNING id::text AS id, content AS text, attachment_url, created_at AS ts`,
        [channelId, payload.sub, content || "", attachmentUrl || null]
      )
      const m = r.rows[0] as { id: string; text: string; attachment_url: string | null; ts: string }
      
      const ur = await pool.query(
        `SELECT COALESCE(display_name, username) AS name, avatar_url FROM users WHERE id=$1::uuid LIMIT 1`,
        [payload.sub]
      )
      const sender = (ur.rows[0]?.name as string) || "User"
      const avatar = ur.rows[0]?.avatar_url as string | null
      
      let roleColor: string | undefined
      const targetServerId = c.rows[0].server_id
      if (c.rows[0].type !== 'dm') {
          try {
             const rc = await pool.query(
               `SELECT roles.color 
                FROM server_member_roles 
                JOIN roles ON roles.id = server_member_roles.role_id
                WHERE server_member_roles.server_id = $1::uuid AND server_member_roles.user_id = $2::uuid
                ORDER BY roles.position ASC LIMIT 1`,
               [c.rows[0].server_id, payload.sub]
             )
             roleColor = rc.rows[0]?.color
          } catch {}
      }

      // --- NOTIFICATIONS & MENTIONS ---
      
      // 1. Handle DM Notifications (Notify all other members)
       if (c.rows[0].type === 'dm') {
           const members = await pool.query(`SELECT user_id FROM channel_members WHERE channel_id=$1::uuid AND user_id!=$2::uuid`, [channelId, payload.sub])
           for (const mem of members.rows) {
              await createNotification(mem.user_id, 'message', m.id, 'dm', `New message from ${sender}`, channelId)
           }
       }
 
       // 2. Handle Mentions in Server Channels
       if (c.rows[0].type !== 'dm' && content) {
           // Regex to find @username
           // We look for @Username (word characters)
           // This is a simple heuristic. Ideally we'd use unique IDs or discriminators.
           const mentions = content.match(/@([a-zA-Z0-9_]+)/g)
           if (mentions) {
              const uniqueNames = [...new Set(mentions.map((m: string) => m.slice(1)))] // remove @
              for (const name of uniqueNames) {
                 // Find user in this server with this username
                 const u = await pool.query(
                     `SELECT u.id FROM users u
                      JOIN server_members sm ON sm.user_id = u.id
                      WHERE sm.server_id = $1::uuid AND u.username = $2
                      LIMIT 1`,
                     [targetServerId, name]
                 )
                 if (u.rowCount && u.rowCount > 0) {
                     const mentionedUserId = u.rows[0].id
                     if (mentionedUserId !== payload.sub) {
                         // Check if user has access to this channel
                         let hasAccess = true
                         // We can reuse the logic from servers.ts or similar, or do a quick check here.
                         // Since notifications are critical, we should ensure we don't leak channel existence or notify people who can't see it.
                         
                         // Check if channel is private
                         const ch = await pool.query(`SELECT is_private, server_id FROM channels WHERE id=$1::uuid`, [channelId])
                         if (ch.rows[0]?.is_private) {
                             hasAccess = false
                             // Check permissions
                             const perms = await pool.query(`SELECT role_id, user_id, allow, deny FROM channel_permissions WHERE channel_id=$1::uuid`, [channelId])
                             const server = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [targetServerId])
                             const ownerId = server.rows[0]?.owner_id
                             
                             if (mentionedUserId === ownerId) {
                                 hasAccess = true
                             } else {
                                 // Get user roles
                                 const roles = await pool.query(`SELECT role_id FROM server_member_roles WHERE user_id=$1::uuid AND server_id=$2::uuid`, [mentionedUserId, targetServerId])
                                 const userRoleIds = roles.rows.map(r => r.role_id)
                                 
                                 // Check admin
                                 const adminRoles = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND (permissions & 8) = 8`, [targetServerId])
                                 const adminRoleIds = new Set(adminRoles.rows.map(r => r.id))
                                 
                                 if (userRoleIds.some((r: string) => adminRoleIds.has(r))) {
                                     hasAccess = true
                                 } else {
                                     // Check overrides
                                     const userPerm = perms.rows.find(p => p.user_id === mentionedUserId)
                                     let allow = false
                                     let deny = false
                                     
                                     if (userPerm) {
                                         if ((userPerm.allow & 1024) === 1024) allow = true
                                         if ((userPerm.deny & 1024) === 1024) deny = true
                                     }
                                     
                                     for (const rid of userRoleIds) {
                                         const rp = perms.rows.find(p => p.role_id === rid)
                                         if (rp) {
                                             if ((rp.allow & 1024) === 1024) allow = true
                                             if ((rp.deny & 1024) === 1024) deny = true
                                         }
                                     }
                                     
                                     if (allow && !deny) hasAccess = true
                                 }
                             }
                         }
                         
                         if (hasAccess) {
                            await createNotification(mentionedUserId, 'mention', m.id, 'message', `You were mentioned by ${sender} in #${channel}`, channelId)
                         }
                     }
                 }
              }
           }
       }

      const msgData = { 
        id: m.id, 
        text: m.text, 
        attachmentUrl: m.attachment_url || undefined, 
        ts: m.ts 
      }

      try {
        await redis.publish("messages", JSON.stringify({ channel: channelId, data: { type: "message", channel: channelId, message: msgData, user: sender, userAvatar: avatar, userId: payload.sub, roleColor } }))
        if (channel !== channelId) {
           await redis.publish("messages", JSON.stringify({ channel, data: { type: "message", channel, message: msgData, user: sender, userAvatar: avatar, userId: payload.sub, roleColor } }))
        }
      } catch {}
      return { message: { ...msgData, roleColor } }
    } catch (e) {
      console.error("POST /api/messages error:", e)
      return { error: `Unauthorized: ${e}` }
    }
  })

async function createNotification(userId: string, type: string, sourceId: string, sourceType: string, content: string, channelId?: string) {
    try {
        // Check quiet mode
        const u = await pool.query(`SELECT notifications_quiet_mode FROM users WHERE id=$1::uuid`, [userId])
        const quiet = u.rows[0]?.notifications_quiet_mode || false
        
        const r = await pool.query(
            `INSERT INTO notifications (user_id, type, source_id, source_type, content, channel_id)
             VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid)
             RETURNING id, created_at`,
            [userId, type, sourceId, sourceType, content, channelId || null]
        )
        const n = r.rows[0]
        
        await redis.publish("messages", JSON.stringify({ 
            channel: `user:${userId}`, 
            data: { 
                type: "notification", 
                notification: { 
                    id: n.id, 
                    type, 
                    sourceId, 
                    sourceType, 
                    content, 
                    channelId,
                    read: false, 
                    ts: n.created_at,
                    quiet 
                } 
            } 
        }))
    } catch (e) {
        console.error("Failed to create notification", e)
    }
}

  app.get("/api/socket-info", async (req: FastifyRequest<{ Querystring: { channel?: string } }>) => {
    const channel = req.query.channel || ""
    const base = process.env.REALTIME_BASE_HTTP || "http://localhost:4001"
    const wsBase = process.env.REALTIME_BASE_WS || "ws://localhost:4001/ws"
    try {
      const res = await fetch(`${base}/socket-info?channel=${encodeURIComponent(channel)}`)
      const data = await res.json() as any
      return { exists: !!data.exists, wsUrl: wsBase }
    } catch (e) {
      console.error("Socket info error:", e)
      return { exists: false, wsUrl: wsBase }
    }
  })

  app.delete("/api/messages/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const { id } = req.params
      
      const m = await pool.query(`SELECT user_id, channel_id FROM messages WHERE id=$1::uuid`, [id])
      if (!m.rowCount) return { error: "Message not found" }
      
      if (m.rows[0].user_id !== payload.sub) {
         return { error: "Unauthorized" }
      }

      await pool.query(`DELETE FROM messages WHERE id=$1::uuid`, [id])
      
      const channelId = m.rows[0].channel_id
      try {
        await redis.publish("messages", JSON.stringify({ 
          channel: channelId, 
          data: { type: "message_delete", channel: channelId, messageId: id } 
        }))
      } catch {}
      
      return { success: true }
    } catch (e) {
      return { error: "Error deleting message" }
    }
  })

  app.patch("/api/messages/:id", async (req: FastifyRequest<{ Params: { id: string }, Body: { content: string } }>) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const { id } = req.params
      const { content } = req.body
      
      if (!content || content.length > 5000) return { error: "Invalid content" }

      const m = await pool.query(`SELECT user_id, channel_id FROM messages WHERE id=$1::uuid`, [id])
      if (!m.rowCount) return { error: "Message not found" }
      
      if (m.rows[0].user_id !== payload.sub) {
         return { error: "Unauthorized" }
      }

      const r = await pool.query(
        `UPDATE messages SET content=$1::text WHERE id=$2::uuid RETURNING content, created_at`,
        [content, id]
      )
      
      const channelId = m.rows[0].channel_id
      try {
        await redis.publish("messages", JSON.stringify({ 
          channel: channelId, 
          data: { 
            type: "message_update", 
            channel: channelId, 
            message: { id, text: content, ts: r.rows[0].created_at } 
          } 
        }))
      } catch {}
      
      return { success: true, message: { id, text: content } }
    } catch (e) {
      return { error: "Error updating message" }
    }
  })
}
