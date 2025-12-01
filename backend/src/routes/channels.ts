import { FastifyInstance, FastifyRequest } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { JWT_SECRET, checkPermission } from "../lib/auth.js"

export async function channelRoutes(app: FastifyInstance) {
  app.get("/api/dms", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      // Find DMs for this user
      const r = await pool.query(
        `SELECT c.id, u.id as user_id, u.username, u.display_name, u.avatar_url, u.status, u.discriminator
         FROM channels c
         JOIN channel_members cm1 ON c.id = cm1.channel_id
         JOIN channel_members cm2 ON c.id = cm2.channel_id
         JOIN users u ON cm2.user_id = u.id
         WHERE c.type = 'dm' 
           AND cm1.user_id = $1::uuid
           AND cm2.user_id != $1::uuid
         ORDER BY c.id`,
        [payload.sub]
      )
      
      return { dms: r.rows.map(row => ({
        id: row.id,
        user: {
          id: row.user_id,
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          status: row.status,
          discriminator: row.discriminator
        }
      }))}
    } catch (e) {
      console.error(e)
      return { error: "Unauthorized" }
    }
  })

  app.post("/api/dms", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const { userId } = body || {}
    if (!auth || !userId) return { error: "Bad request" }
    
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      if (userId === payload.sub) return { error: "Cannot DM self" }
      
      // But first check if DM exists
      const check = await pool.query(
        `SELECT c.id 
         FROM channels c
         JOIN channel_members cm1 ON c.id = cm1.channel_id
         JOIN channel_members cm2 ON c.id = cm2.channel_id
         WHERE c.type = 'dm' AND cm1.user_id = $1::uuid AND cm2.user_id = $2::uuid
         LIMIT 1`,
        [payload.sub, userId]
      )
      
      if (check.rowCount && check.rowCount > 0) {
        return { id: check.rows[0].id }
      }
      
      // Check if target allows DMs
      const u = await pool.query(`SELECT allow_dms_from_strangers FROM users WHERE id=$1::uuid`, [userId])
      if (!u.rows[0]) return { error: "User not found" }
      
      // Check friendship
      const [id1, id2] = [payload.sub, userId].sort()
      const f = await pool.query(`SELECT status FROM friendships WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid`, [id1, id2])
      const isFriend = f.rows[0]?.status === 'accepted'
      
      // If not friends and not allowed strangers, block
      if (!isFriend && !u.rows[0].allow_dms_from_strangers) {
         // Double check if there's a shared server? Discord allows DMs if shared server usually.
         // For now, just stick to the rule: Friends OR Allow Strangers
         return { error: "User does not accept DMs" }
      }
      
      // Create DM
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const c = await client.query(`INSERT INTO channels (type, name) VALUES ('dm', 'dm') RETURNING id`, [])
        const cid = c.rows[0].id
        await client.query(`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)`, [cid, payload.sub, userId])
        await client.query('COMMIT')
        return { id: cid }
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
      
    } catch (e) {
      console.error(e)
      return { error: "Server error" }
    }
  })

  app.post("/api/channels", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const { serverId, name, category, permissions } = body || {}
    if (!auth || !serverId || !name || !category) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const allowed = await checkPermission(payload.sub, serverId, 'can_manage_channels')
      if (!allowed) return { error: "Missing permissions" }
      
      const client = await pool.connect()
      try {
         await client.query('BEGIN')
         const r = await client.query(
           `INSERT INTO channels (server_id, name, category) VALUES ($1::uuid,$2::text,$3::text)
            RETURNING id::text AS id, name, category`,
           [serverId, name, category]
         )
         const channel = r.rows[0] as { id: string; name: string; category: string }
         
         if (Array.isArray(permissions)) {
           for (const p of permissions) {
             await client.query(
               `INSERT INTO channel_permissions (channel_id, role_id, can_view, can_send_messages) VALUES ($1::uuid, $2::uuid, $3::boolean, $4::boolean)`,
               [channel.id, p.roleId, !!p.canView, !!p.canSendMessages]
             )
           }
         }
         
         await client.query('COMMIT')
         return { channel }
      } catch (e) {
         await client.query('ROLLBACK')
         throw e
      } finally {
         client.release()
      }
    } catch (e) {
      console.error(e)
      return { error: "Unauthorized" }
    }
  })

  app.patch("/api/channels/:id", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const id = (req.params as any).id as string
    const { name, permissions } = body || {}
    if (!auth || !id) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const c = await pool.query('SELECT server_id FROM channels WHERE id=$1::uuid', [id])
      const serverId = c.rows[0]?.server_id
      if (!serverId) return { error: "Not found" }
      const allowed = await checkPermission(payload.sub, serverId, 'can_manage_channels')
      if (!allowed) return { error: "Missing permissions" }
      
      const client = await pool.connect()
      try {
         await client.query('BEGIN')
         
         if (name) {
            await client.query(`UPDATE channels SET name=$2 WHERE id=$1::uuid`, [id, name])
         }
         
         if (Array.isArray(permissions)) {
            // Replace all permissions
            await client.query(`DELETE FROM channel_permissions WHERE channel_id=$1::uuid`, [id])
            for (const p of permissions) {
               await client.query(
                 `INSERT INTO channel_permissions (channel_id, role_id, can_view, can_send_messages) VALUES ($1::uuid, $2::uuid, $3::boolean, $4::boolean)`,
                 [id, p.roleId, !!p.canView, !!p.canSendMessages]
               )
            }
         }
         
         const r = await client.query(`SELECT id::text AS id, name FROM channels WHERE id=$1::uuid`, [id])
         await client.query('COMMIT')
         return { channel: r.rows[0] }
      } catch (e) {
         await client.query('ROLLBACK')
         throw e
      } finally {
         client.release()
      }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.get("/api/channels/:id/permissions", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    if (!auth || !id) return { error: "Bad request" }
    try {
      jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
      const r = await pool.query(
        `SELECT role_id::text AS "roleId", can_view AS "canView", can_send_messages AS "canSendMessages"
         FROM channel_permissions WHERE channel_id=$1::uuid`,
        [id]
      )
      return { permissions: r.rows }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.delete("/api/channels/:id", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    if (!auth || !id) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const c = await pool.query('SELECT server_id FROM channels WHERE id=$1::uuid', [id])
      const serverId = c.rows[0]?.server_id
      if (!serverId) return { error: "Not found" }
      const allowed = await checkPermission(payload.sub, serverId, 'can_manage_channels')
      if (!allowed) return { error: "Missing permissions" }
      await pool.query(`DELETE FROM channels WHERE id=$1::uuid`, [id])
      return { ok: true }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.get("/api/channels", async (req: FastifyRequest<{ Querystring: { serverId?: string } }>) => {
    const auth = (req.headers as any).authorization as string | undefined
    try {
      const serverId = req.query.serverId || null
      let userId: string | null = null
      
      if (auth) {
         try {
           const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
           userId = payload.sub
         } catch {}
      }

      let query = `SELECT c.id, c.name, c.category, c.type, FALSE as "canSendMessages" FROM channels c WHERE ($1::uuid IS NULL OR c.server_id=$1::uuid) `
      const params: any[] = [serverId]
      
      if (userId) {
         // Check if owner
         const s = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
         const isOwner = s.rows[0]?.owner_id === userId
         
         if (!isOwner) {
            // Filter by permissions
            // Logic:
            // 1. If channel is DM, allow (handled by other logic usually, but included for safety)
            // 2. If NO permissions exist for this channel, it's public -> Allow
            // 3. If permissions EXIST, user must have AT LEAST ONE role that allows viewing -> Allow
            query += `
              AND (
                c.type = 'dm' OR
                NOT EXISTS (SELECT 1 FROM channel_permissions cp WHERE cp.channel_id = c.id)
                OR EXISTS (
                   SELECT 1 
                   FROM channel_permissions cp
                   JOIN server_member_roles smr ON smr.role_id = cp.role_id
                   WHERE cp.channel_id = c.id 
                     AND smr.user_id = $2::uuid
                     AND smr.server_id = c.server_id
                     AND cp.can_view = TRUE
                )
                OR EXISTS (
                   SELECT 1 
                   FROM server_member_roles smr
                   JOIN roles r ON r.id = smr.role_id
                   WHERE smr.user_id = $2::uuid 
                     AND smr.server_id = c.server_id 
                     AND (r.can_manage_channels = TRUE OR r.can_manage_server = TRUE)
                )
              )
            `
            params.push(userId)
         }
      }

      query += ` ORDER BY c.category, c.name`
      
      const ch = await pool.query(query, params)
      
      // Post-process canSendMessages
      if (userId) {
          const s = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
          const isOwner = s.rows[0]?.owner_id === userId
          
          // Ensure user roles are synced (Self-healing for legacy data)
          await pool.query(`
            INSERT INTO server_member_roles (server_id, user_id, role_id)
            SELECT server_id, user_id, role_id FROM server_members 
            WHERE user_id = $1::uuid AND server_id = $2::uuid AND role_id IS NOT NULL
            ON CONFLICT DO NOTHING
          `, [userId, serverId])

          const allChannelIdsWithPerms = await pool.query(
               `SELECT DISTINCT channel_id FROM channel_permissions 
                JOIN channels ON channels.id = channel_permissions.channel_id
                WHERE channels.server_id = $1::uuid`,
               [serverId]
          )
          const restrictedChannels = new Set(allChannelIdsWithPerms.rows.map(r => r.channel_id))
          
          // Get channels where user has explicit ALLOW permission
          const userPerms = await pool.query(
               `SELECT cp.channel_id
                FROM channel_permissions cp
                JOIN server_member_roles smr ON smr.role_id = cp.role_id
                WHERE smr.user_id = $1::uuid AND smr.server_id = $2::uuid
                  AND cp.can_send_messages = TRUE`,
               [userId, serverId]
          )
          const allowedByPerms = new Set<string>(userPerms.rows.map(r => r.channel_id))

          // Check admin/manager permissions
          const admin = await pool.query(
               `SELECT 1 FROM server_member_roles smr
                JOIN roles r ON r.id = smr.role_id
                WHERE smr.user_id = $1::uuid AND smr.server_id = $2::uuid
                  AND (r.can_manage_server = TRUE OR r.can_manage_channels = TRUE)`,
               [userId, serverId]
          )
          const isAdmin = admin.rowCount && admin.rowCount > 0

          for (const row of ch.rows) {
              if (row.type === 'dm') {
                 row.canSendMessages = true
              } else if (isOwner || isAdmin) {
                 row.canSendMessages = true
              } else {
                 // If restricted, must be in allowedByPerms
                 if (restrictedChannels.has(row.id)) {
                    row.canSendMessages = allowedByPerms.has(row.id)
                 } else {
                    // Public
                    row.canSendMessages = true
                 }
              }
          }
      }

      const cats = await pool.query(
        `SELECT name FROM channel_categories WHERE ($1::uuid IS NULL OR server_id=$1::uuid) ORDER BY name`,
        [serverId]
      )
      const byCat = new Map<string, { id: string, name: string, type: string, canSendMessages: boolean }[]>()
      for (const row of ch.rows as { id: string; name: string; category: string; type: string; canSendMessages: boolean }[]) {
        const arr = byCat.get(row.category) || []
        arr.push(row)
        byCat.set(row.category, arr)
      }
      for (const c of cats.rows as { name: string }[]) {
        if (!byCat.has(c.name)) byCat.set(c.name, [])
      }
      const sections = Array.from(byCat.entries()).map(([title, channels]) => ({ title, channels: channels.map(c => ({ id: c.id, name: c.name, type: c.type, canSendMessages: c.canSendMessages })) }))
      sections.sort((a, b) => a.title.localeCompare(b.title))
      return { sections }
    } catch (e) {
      console.error(e)
      return { sections: [] }
    }
  })

  app.get("/api/channel-by-name", async (req: FastifyRequest<{ Querystring: { serverId?: string; name?: string } }>) => {
    try {
      const serverId = req.query.serverId
      const name = req.query.name
      if (!serverId || !name) return { error: "Bad request" }
      const r = await pool.query(
        `SELECT id::text AS id FROM channels WHERE server_id=$1::uuid AND name=$2::text LIMIT 1`,
        [serverId, name]
      )
      const id = r.rows[0]?.id as string | undefined
      if (!id) return { error: "Not found" }
      return { id }
    } catch {
      return { error: "Server error" }
    }
  })

  app.post("/api/categories", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const { serverId, name } = body || {}
    if (!auth || !serverId || !name) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const allowed = await checkPermission(payload.sub, serverId, 'can_manage_channels')
      if (!allowed) return { error: "Missing permissions" }
      const r = await pool.query(
        `INSERT INTO channel_categories (server_id, name) VALUES ($1::uuid,$2::text)
         RETURNING id::text AS id, name`,
        [serverId, name]
      )
      return { category: r.rows[0] as { id: string; name: string } }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.patch("/api/categories/:id", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const id = (req.params as any).id as string
    const { name } = body || {}
    if (!auth || !id || !name) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const c = await pool.query('SELECT server_id FROM channel_categories WHERE id=$1::uuid', [id])
      const serverId = c.rows[0]?.server_id
      if (!serverId) return { error: "Not found" }
      const allowed = await checkPermission(payload.sub, serverId, 'can_manage_channels')
      if (!allowed) return { error: "Missing permissions" }
      const r = await pool.query(`UPDATE channel_categories SET name=$2 WHERE id=$1::uuid RETURNING id::text AS id, name`, [id, name])
      return { category: r.rows[0] as { id: string; name: string } }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.delete("/api/categories/:id", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    if (!auth || !id) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const c = await pool.query('SELECT server_id FROM channel_categories WHERE id=$1::uuid', [id])
      const serverId = c.rows[0]?.server_id
      if (!serverId) return { error: "Not found" }
      const allowed = await checkPermission(payload.sub, serverId, 'can_manage_channels')
      if (!allowed) return { error: "Missing permissions" }
      await pool.query(`DELETE FROM channel_categories WHERE id=$1::uuid`, [id])
      return { ok: true }
    } catch {
      return { error: "Unauthorized" }
    }
  })
}
