import { FastifyInstance, FastifyRequest } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { redis } from "../lib/redis.js"
import { JWT_SECRET } from "../lib/auth.js"

const CHANNEL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveChannelId(channel: string | undefined, serverId?: string): Promise<string | null> {
  if (!channel) return null
  if (CHANNEL_UUID_RE.test(channel)) return channel

  const r = serverId
    ? await pool.query(
        `SELECT id::text AS id
         FROM channels
         WHERE name=$1::text
           AND server_id=$2::uuid
         LIMIT 1`,
        [channel, serverId],
      )
    : await pool.query(
        `SELECT id::text AS id
         FROM channels
         WHERE name=$1::text
         LIMIT 1`,
        [channel],
      )
  return (r.rows[0]?.id as string | undefined) || null
}

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

      const channelId = await resolveChannelId(channel, serverId || undefined)
      if (!channelId) return { messages: [] }

      // Verify access
      const c = await pool.query(`SELECT server_id, type, name FROM channels WHERE id=$1::uuid`, [channelId])
      if (!c.rowCount) return { messages: [] }

      const channelRow = c.rows[0] as { server_id: string | null; type: string; name: string | null }

      if (channelRow.type === 'dm') {
          const m = await pool.query(`SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, [channelId, payload.sub])
          if (!m.rowCount) return { error: "Unauthorized" }
      } else if (channelRow.server_id) {
          const perms = await pool.query(
            `SELECT EXISTS(
                      SELECT 1
                      FROM channel_permissions cp_exists
                      WHERE cp_exists.channel_id = $1::uuid
                    ) AS has_permissions,
                    COALESCE(bool_or(cp.can_view), FALSE) AS can_view,
                    EXISTS(
                      SELECT 1
                      FROM servers s
                      WHERE s.id = $3::uuid
                        AND s.owner_id = $2::uuid
                    ) AS is_owner
             FROM server_member_roles smr
             LEFT JOIN channel_permissions cp
               ON cp.channel_id = $1::uuid
              AND cp.role_id = smr.role_id
             WHERE smr.user_id = $2::uuid
               AND smr.server_id = $3::uuid`,
            [channelId, payload.sub, channelRow.server_id],
          )
          const guard = perms.rows[0] as { has_permissions: boolean; can_view: boolean; is_owner: boolean }
          if (guard.has_permissions && !guard.can_view && !guard.is_owner) {
            return { error: "Unauthorized" }
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

      const channelId = await resolveChannelId(channel, serverId || undefined)
      if (!channelId) return { error: "Channel not found" }

      const c = await pool.query(`SELECT server_id, type, name FROM channels WHERE id=$1::uuid`, [channelId])
      if (!c.rowCount) return { error: "Channel not found" }

      const channelRow = c.rows[0] as { server_id: string | null; type: string; name: string | null }

      if (channelRow.type === 'dm') {
         const m = await pool.query(`SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, [channelId, payload.sub])
         if (!m.rowCount) return { error: "Not a member of this DM" }
      } else if (channelRow.server_id) {
         const access = await pool.query(
           `SELECT sm.muted AS muted,
                   EXISTS(
                     SELECT 1
                     FROM channel_permissions cp_exists
                     WHERE cp_exists.channel_id = $1::uuid
                   ) AS has_permissions,
                   COALESCE(bool_or(cp.can_send_messages), FALSE) AS can_send,
                   COALESCE(bool_or((r.can_manage_server = TRUE) OR (r.can_manage_channels = TRUE)), FALSE) AS is_admin,
                   EXISTS(
                     SELECT 1
                     FROM servers s
                     WHERE s.id = $3::uuid
                       AND s.owner_id = $2::uuid
                   ) AS is_owner
            FROM server_members sm
            LEFT JOIN server_member_roles smr
              ON smr.server_id = sm.server_id
             AND smr.user_id = sm.user_id
            LEFT JOIN roles r
              ON r.id = smr.role_id
            LEFT JOIN channel_permissions cp
              ON cp.channel_id = $1::uuid
             AND cp.role_id = smr.role_id
            WHERE sm.server_id = $3::uuid
              AND sm.user_id = $2::uuid
            GROUP BY sm.muted`,
           [channelId, payload.sub, channelRow.server_id]
         )
         if (!access.rowCount) return { error: "Not a member of this server" }

         const guard = access.rows[0] as {
           muted: boolean
           has_permissions: boolean
           can_send: boolean
           is_admin: boolean
           is_owner: boolean
         }

         if (guard.muted) return { error: "You are muted" }
         if (guard.has_permissions && !guard.can_send && !guard.is_owner && !guard.is_admin) {
           return { error: "Missing permissions" }
         }
      }

      const r = await pool.query(
        `WITH inserted AS (
           INSERT INTO messages (channel_id, user_id, content, attachment_url)
           VALUES ($1::uuid, $2::uuid, $3::text, $4::text)
           RETURNING id::text AS id, content AS text, attachment_url, created_at AS ts, user_id
         )
         SELECT inserted.id,
                inserted.text,
                inserted.attachment_url,
                inserted.ts,
                COALESCE(u.display_name, u.username) AS sender_name,
                u.avatar_url AS sender_avatar
         FROM inserted
         LEFT JOIN users u ON u.id = inserted.user_id`,
        [channelId, payload.sub, content || "", attachmentUrl || null]
      )
      const m = r.rows[0] as {
        id: string
        text: string
        attachment_url: string | null
        ts: string
        sender_name: string | null
        sender_avatar: string | null
      }
      const sender = m.sender_name || "User"
      const avatar = m.sender_avatar
      
      const msgData = { 
        id: m.id, 
        text: m.text, 
        attachmentUrl: m.attachment_url || undefined, 
        ts: m.ts 
      }

      try {
        const publishes: Promise<number>[] = [
          redis.publish("messages", JSON.stringify({ channel: channelId, data: { type: "message", channel: channelId, message: msgData, user: sender, userAvatar: avatar, userId: payload.sub } })),
        ]
        if (channel !== channelId) {
          publishes.push(
            redis.publish("messages", JSON.stringify({ channel, data: { type: "message", channel, message: msgData, user: sender, userAvatar: avatar, userId: payload.sub } })),
          )
        }
        await Promise.all(publishes)
      } catch {}

      // Offload notifications/mentions from the response path.
      void processMessageSideEffects({
        channelId,
        channelName: String(channelRow.name || channel),
        channelType: channelRow.type,
        serverId: channelRow.server_id || undefined,
        senderId: payload.sub,
        senderName: sender,
        messageId: m.id,
        content: content || "",
      })

      return { message: msgData }
    } catch (e) {
      console.error("POST /api/messages error:", e)
      return { error: `Unauthorized: ${e}` }
    }
  })

async function processMessageSideEffects(args: {
  channelId: string
  channelName: string
  channelType: "dm" | string
  serverId?: string
  senderId: string
  senderName: string
  messageId: string
  content: string
}) {
  const { channelId, channelName, channelType, serverId, senderId, senderName, messageId, content } = args
  try {
    if (channelType === "dm") {
      const members = await pool.query(
        `SELECT user_id::text AS user_id FROM channel_members WHERE channel_id=$1::uuid AND user_id!=$2::uuid`,
        [channelId, senderId]
      )
      await Promise.all(
        members.rows.map((mem) =>
          createNotification(mem.user_id as string, "message", messageId, "dm", `New message from ${senderName}`, channelId, { channelType: "dm" })
        )
      )
      return
    }

    if (!serverId || !content) return
    const mentions = content.match(/@([a-zA-Z0-9_]+)/g)
    if (!mentions || mentions.length === 0) return

    const uniqueNames = [...new Set(mentions.map((m) => m.slice(1)))]
    if (uniqueNames.length === 0) return

    const users = await pool.query(
      `SELECT u.id::text AS id
       FROM users u
       JOIN server_members sm ON sm.user_id = u.id
       WHERE sm.server_id = $1::uuid
         AND u.username = ANY($2::text[])`,
      [serverId, uniqueNames]
    )
    const mentionedUserIds = users.rows
      .map((u) => String(u.id))
      .filter((uid) => uid && uid !== senderId)
    if (mentionedUserIds.length === 0) return

    const channelPerms = await pool.query(
      `SELECT role_id::text AS role_id, can_view
       FROM channel_permissions
       WHERE channel_id = $1::uuid`,
      [channelId]
    )
    const restricted = (channelPerms.rowCount || 0) > 0
    let allowedUserIds = new Set<string>(mentionedUserIds)

    if (restricted) {
      const [serverRow, rolesRow] = await Promise.all([
        pool.query(`SELECT owner_id::text AS owner_id FROM servers WHERE id = $1::uuid`, [serverId]),
        pool.query(
          `SELECT smr.user_id::text AS user_id,
                  smr.role_id::text AS role_id,
                  r.can_manage_server,
                  r.can_manage_channels
           FROM server_member_roles smr
           JOIN roles r ON r.id = smr.role_id
           WHERE smr.server_id = $1::uuid
             AND smr.user_id = ANY($2::uuid[])`,
          [serverId, mentionedUserIds]
        ),
      ])

      const ownerId = String(serverRow.rows[0]?.owner_id || "")
      const canViewRoleIds = new Set(
        channelPerms.rows
          .filter((row) => !!row.can_view)
          .map((row) => String(row.role_id))
      )
      const rolesByUser = new Map<
        string,
        { roleId: string; canManageServer: boolean; canManageChannels: boolean }[]
      >()

      for (const row of rolesRow.rows) {
        const userId = String(row.user_id)
        const arr = rolesByUser.get(userId) || []
        arr.push({
          roleId: String(row.role_id),
          canManageServer: !!row.can_manage_server,
          canManageChannels: !!row.can_manage_channels,
        })
        rolesByUser.set(userId, arr)
      }

      allowedUserIds = new Set<string>()
      for (const uid of mentionedUserIds) {
        if (uid === ownerId) {
          allowedUserIds.add(uid)
          continue
        }
        const userRoles = rolesByUser.get(uid) || []
        const isManager = userRoles.some((r) => r.canManageServer || r.canManageChannels)
        if (isManager) {
          allowedUserIds.add(uid)
          continue
        }
        const canView = userRoles.some((r) => canViewRoleIds.has(r.roleId))
        if (canView) {
          allowedUserIds.add(uid)
        }
      }
    }

    await Promise.all(
      [...allowedUserIds].map((uid) =>
        createNotification(
          uid,
          "mention",
          messageId,
          "message",
          `You were mentioned by ${senderName} in #${channelName}`,
          channelId,
          { channelName, serverId, channelType },
        )
      )
    )
  } catch (e) {
    console.error("Failed to process message side effects", e)
  }
}

async function createNotification(
  userId: string,
  type: string,
  sourceId: string,
  sourceType: string,
  content: string,
  channelId?: string,
  channelMeta?: { channelName?: string; serverId?: string; channelType?: string },
) {
    try {
        const r = await pool.query(
            `WITH user_settings AS (
               SELECT COALESCE(notifications_quiet_mode, FALSE) AS quiet
               FROM users
               WHERE id = $1::uuid
             ),
             inserted AS (
               INSERT INTO notifications (user_id, type, source_id, source_type, content, channel_id)
               VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid)
               RETURNING id, created_at
             )
             SELECT inserted.id, inserted.created_at, COALESCE(user_settings.quiet, FALSE) AS quiet
             FROM inserted
             LEFT JOIN user_settings ON TRUE`,
            [userId, type, sourceId, sourceType, content, channelId || null]
        )
        const n = r.rows[0] as { id: string; created_at: string; quiet: boolean }
        const quiet = !!n.quiet

        let resolvedMeta = channelMeta
        if (channelId && !resolvedMeta) {
            const c = await pool.query(
              `SELECT name, server_id::text AS "serverId", type
               FROM channels
               WHERE id = $1::uuid
               LIMIT 1`,
              [channelId]
            )
            if (c.rowCount) {
              resolvedMeta = {
                channelName: c.rows[0]?.name as string | undefined,
                serverId: c.rows[0]?.serverId as string | undefined,
                channelType: c.rows[0]?.type as string | undefined,
              }
            }
        }
        
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
                    channelName: resolvedMeta?.channelName,
                    serverId: resolvedMeta?.serverId,
                    channelType: resolvedMeta?.channelType,
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
