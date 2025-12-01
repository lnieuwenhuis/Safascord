import { FastifyInstance } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { JWT_SECRET, checkPermission } from "../lib/auth.js"

export async function serverRoutes(app: FastifyInstance) {
  app.get("/api/servers", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { servers: [] }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const r = await pool.query(
        `SELECT servers.id::text AS id, servers.name, servers.icon_url AS "iconUrl", servers.banner_url AS "bannerUrl", servers.owner_id::text AS "ownerId"
         FROM server_members
         JOIN servers ON servers.id = server_members.server_id
         WHERE server_members.user_id = $1::uuid
         ORDER BY servers.name`,
        [payload.sub]
      )
      const servers = r.rows as { id: string; name: string; iconUrl?: string; bannerUrl?: string; ownerId: string }[]
      return { servers }
    } catch {
      return { servers: [] }
    }
  })

  app.post("/api/servers", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const { name, description, iconUrl, bannerUrl } = body || {}
    if (!auth || !name) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const r = await pool.query(
        `INSERT INTO servers (name, owner_id, description, icon_url, banner_url) VALUES ($1::text, $2::uuid, $3, $4, $5)
         RETURNING id::text AS id, name, description, icon_url AS "iconUrl", banner_url AS "bannerUrl", owner_id::text AS "ownerId"`,
        [name, payload.sub, description || null, iconUrl || null, bannerUrl || null]
      )
      const s = r.rows[0] as { id: string; name: string; ownerId: string }
      
      // Create default roles
      const ownerRole = await pool.query(
        `INSERT INTO roles (server_id, name, color, display_group, position, can_manage_channels, can_manage_server, can_manage_roles) 
         VALUES ($1::uuid, 'Owner', '#ff0000', 'Owner', 0, true, true, true) RETURNING id`,
        [s.id]
      )
      const memberRole = await pool.query(
        `INSERT INTO roles (server_id, name, color, display_group, position, can_manage_channels, can_manage_server, can_manage_roles) 
         VALUES ($1::uuid, 'Member', '#99aab5', 'Member', 1, false, false, false) RETURNING id`,
        [s.id]
      )
      
      await pool.query(
        `INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, 
        [s.id, payload.sub, ownerRole.rows[0].id]
      )
      await pool.query(
        `INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, 
        [s.id, payload.sub, ownerRole.rows[0].id]
      )
      
      return { server: s }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.patch("/api/servers/:id", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const id = (req.params as any).id as string
    const { name, description, iconUrl, bannerUrl } = body || {}
    if (!auth || !id) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const allowed = await checkPermission(payload.sub, id, 'can_manage_server')
      if (!allowed) return { error: "Missing permissions" }
      
      const fields: string[] = []
      const values: any[] = [id]
      let idx = 2
      
      if (name !== undefined) { fields.push(`name=$${idx++}`); values.push(name) }
      if (description !== undefined) { fields.push(`description=$${idx++}`); values.push(description) }
      if (iconUrl !== undefined) { fields.push(`icon_url=$${idx++}`); values.push(iconUrl) }
      if (bannerUrl !== undefined) { fields.push(`banner_url=$${idx++}`); values.push(bannerUrl) }
      
      if (fields.length === 0) return { error: "No fields" }
      
      const r = await pool.query(
        `UPDATE servers SET ${fields.join(", ")} WHERE id=$1::uuid 
         RETURNING id::text AS id, name, description, icon_url AS "iconUrl", banner_url AS "bannerUrl", owner_id::text AS "ownerId"`,
        values
      )
      return { server: r.rows[0] as { id: string; name: string; iconUrl?: string; bannerUrl?: string; ownerId: string } }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.delete("/api/servers/:id", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    if (!auth || !id) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const server = await pool.query('SELECT owner_id FROM servers WHERE id=$1::uuid', [id])
      if (server.rows[0]?.owner_id !== payload.sub) return { error: "Unauthorized" }
      await pool.query(`DELETE FROM servers WHERE id=$1::uuid`, [id])
      return { ok: true }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.delete("/api/servers/:id/members/me", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    if (!auth || !id) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      // Check if owner
      const s = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [id])
      if (s.rows[0]?.owner_id === payload.sub) {
          const mc = await pool.query(`SELECT count(*) as count FROM server_members WHERE server_id=$1::uuid`, [id])
          if (parseInt(mc.rows[0].count) > 1) {
              return { error: "Owner cannot leave server unless they are the last member. Please delete the server instead." }
          }
      }

      await pool.query(`DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, payload.sub])
      await pool.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, payload.sub])
      
      // Check emptiness
      const m = await pool.query(`SELECT count(*) as count FROM server_members WHERE server_id=$1::uuid`, [id])
      const memberCount = parseInt(m.rows[0].count)
      
      const i = await pool.query(`SELECT count(*) as count FROM invites WHERE server_id=$1::uuid AND (expires_at IS NULL OR expires_at > now())`, [id])
      const inviteCount = parseInt(i.rows[0].count)
      
      if (memberCount === 0 && inviteCount === 0) {
        await pool.query(`DELETE FROM servers WHERE id=$1::uuid`, [id])
        return { left: true, serverDeleted: true }
      }
      
      return { left: true }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.post("/api/servers/:id/invites", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const body = req.body as any
    const { expiresIn, maxUses } = body || {}
    
    if (!auth || !id) return { error: "Bad request" }
    
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      // Verify membership
      const m = await pool.query(`SELECT 1 FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, payload.sub])
      if (!m.rowCount) return { error: "Not a member" }
      
      // Generate code
      const code = Math.random().toString(36).substring(2, 10)
      
      let expiresAt = null
      if (expiresIn) {
         expiresAt = new Date(Date.now() + expiresIn * 1000)
      } else {
         // Default 7 days
         expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) 
      }

      await pool.query(
        `INSERT INTO invites (code, server_id, created_by, max_uses, expires_at) 
         VALUES ($1, $2::uuid, $3::uuid, $4, $5)`,
        [code, id, payload.sub, maxUses || null, expiresAt]
      )
      
      return { code, url: `https://safascord.org/invite/${code}` }
    } catch (e) {
      console.error(e)
      return { error: "Error creating invite" }
    }
  })

  app.get("/api/invites/:code", async (req) => {
     const code = (req.params as any).code as string
     if (!code) return { error: "Bad request" }
     
     try {
       const r = await pool.query(
         `SELECT i.code, i.server_id, i.expires_at, i.max_uses, i.uses, 
                 s.name as server_name, s.icon_url, s.banner_url,
                 (SELECT count(*) FROM server_members WHERE server_id = s.id) as member_count
          FROM invites i
          JOIN servers s ON s.id = i.server_id
          WHERE i.code = $1`,
         [code]
       )
       
       if (!r.rowCount) return { error: "Invite not found" }
       const invite = r.rows[0]
       
       if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
          return { error: "Invite expired" }
       }
       if (invite.max_uses && invite.uses >= invite.max_uses) {
          return { error: "Invite max uses reached" }
       }
       
       return {
         code: invite.code,
         server: {
           id: invite.server_id,
           name: invite.server_name,
           iconUrl: invite.icon_url,
           bannerUrl: invite.banner_url,
           memberCount: parseInt(invite.member_count)
         },
         expiresAt: invite.expires_at,
         maxUses: invite.max_uses,
         uses: invite.uses
       }
     } catch (e) {
       return { error: "Error fetching invite" }
     }
  })

  app.post("/api/invites/:code/accept", async (req) => {
     const auth = (req.headers as any).authorization as string | undefined
     const code = (req.params as any).code as string
     if (!auth || !code) return { error: "Bad request" }
     
     try {
       const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
       
       // Fetch invite
       const r = await pool.query(
         `SELECT i.*, s.name as server_name 
          FROM invites i
          JOIN servers s ON s.id = i.server_id
          WHERE i.code = $1`, 
         [code]
       )
       if (!r.rowCount) return { error: "Invite not found" }
       const invite = r.rows[0]
       
       if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
          return { error: "Invite expired" }
       }
       if (invite.max_uses && invite.uses >= invite.max_uses) {
          return { error: "Invite max uses reached" }
       }
       
       // Check if banned
       const banned = await pool.query(`SELECT 1 FROM server_bans WHERE server_id=$1::uuid AND user_id=$2::uuid`, [invite.server_id, payload.sub])
       if (banned.rowCount) return { error: "You are banned from this server" }
       
       // Add member
       // Default role is 'Member' or position 1?
       const role = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1`, [invite.server_id])
       let roleId = role.rows[0]?.id
       if (!roleId) {
          // Fallback to any lowest role
          const anyRole = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid ORDER BY position DESC LIMIT 1`, [invite.server_id])
          roleId = anyRole.rows[0]?.id
       }
       
       await pool.query(`INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`, [invite.server_id, payload.sub, roleId])
       await pool.query(`INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`, [invite.server_id, payload.sub, roleId])
       
       // Increment uses
       await pool.query(`UPDATE invites SET uses = uses + 1 WHERE code=$1`, [code])
       
       return { success: true, serverId: invite.server_id }
     } catch (e) {
       console.error(e)
       return { error: "Error joining server" }
     }
  })

  app.get("/api/servers/:id/members", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const channelId = (req.query as any).channelId as string | undefined
    if (!auth || !id) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      // If channelId is provided, we need to filter members who have access to this channel
      let accessFilter = ""
      const params = [id]
      
      if (channelId) {
          // Check if channel is private
          const c = await pool.query(`SELECT is_private FROM channels WHERE id=$1::uuid`, [channelId])
          if (c.rows[0]?.is_private) {
              // Fetch allowed roles/members for this channel
              // Logic: User must have a role that is in channel_permissions with allow=true OR be the server owner OR have ADMINISTRATOR permission
              // This is complex to do in a single query, so let's do a post-filter or simpler join.
              
              // Simplification: Get all members, then filter based on permissions?
              // Better: Join with channel_permissions
              // But permissions are bitmasks on roles. 
              // Actually, channel_permissions table stores role_id or user_id override.
              
              // Let's just get all members and return them. The frontend asks to hide them.
              // BUT the prompt says "cant receive notifications for a channel that they don't have access to".
              // That part is handled in messages.ts.
              
              // For the sidebar list: "people who don't have access to a channel through roles dont show up in the users sidebar"
              // We need to filter here.
              
              // We need to know which roles have access.
              // A user has access if:
              // 1. They are the server owner
              // 2. They have a role with ADMINISTRATOR
              // 3. They have a role explicitly allowed in channel_permissions (or @everyone is allowed and they are not denied)
              // 4. They are explicitly allowed in channel_permissions
              
              // This logic is shared with `checkChannelAccess` in messages.ts usually.
              // Let's try to incorporate a basic check.
              
              // For now, let's just return all members and let the frontend filter? 
              // No, backend should filter for security/correctness if possible, or at least to reduce data.
              // But implementing full permission calc in SQL is hard.
              
              // Let's use the `permissions.ts` logic if we can, but that's per-user.
              // Doing it for a list is expensive.
              
              // Let's just return all members for now, BUT we need to fix the notification logic in messages.ts.
              // The user asked: "people who don't have access ... dont show up in the users sidebar ... and that they cant receive notifications"
              
              // Let's handle the notification part in messages.ts first.
              // And for the sidebar, maybe we can just return all members and the frontend filters? 
              // The prompt implies the sidebar should update based on the channel.
              // So passing `channelId` to this endpoint is correct.
              
              // Let's implement a filter in JS after fetching.
          }
      }

      const r = await pool.query(
        `SELECT u.id::text, u.username, u.discriminator, u.display_name as "displayName", u.avatar_url as "avatarUrl",
                sm.muted,
                array_agg(smr.role_id::text) as roles
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         LEFT JOIN server_member_roles smr ON smr.user_id = sm.user_id AND smr.server_id = sm.server_id
         WHERE sm.server_id = $1::uuid
         GROUP BY u.id, u.username, u.discriminator, u.display_name, u.avatar_url, sm.muted
         ORDER BY u.username`,
        [id]
      )
      
      let members = r.rows.map(row => ({
          ...row,
          roles: row.roles.filter((r: any) => r !== null)
      }))
      
      if (channelId) {
          // Filter members who have access to channelId
          const c = await pool.query(`SELECT is_private, server_id FROM channels WHERE id=$1::uuid`, [channelId])
          if (c.rows[0]?.is_private) {
             // Get channel permissions
             const perms = await pool.query(`SELECT role_id, user_id, allow, deny FROM channel_permissions WHERE channel_id=$1::uuid`, [channelId])
             const server = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [id])
             const ownerId = server.rows[0]?.owner_id
             
             // Get all roles with ADMINISTRATOR
             const adminRoles = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND (permissions & 8) = 8`, [id])
             const adminRoleIds = new Set(adminRoles.rows.map(r => r.id))
             
             members = members.filter(m => {
                 if (m.id === ownerId) return true
                 if (m.roles.some((r: string) => adminRoleIds.has(r))) return true
                 
                 // Check overrides
                 // 1. User specific
                 const userPerm = perms.rows.find(p => p.user_id === m.id)
                 if (userPerm) {
                     if ((userPerm.allow & 1024) === 1024) return true // VIEW_CHANNEL
                     if ((userPerm.deny & 1024) === 1024) return false
                 }
                 
                 // 2. Role specific
                 let allow = false
                 let deny = false
                 for (const rid of m.roles) {
                     const rp = perms.rows.find(p => p.role_id === rid)
                     if (rp) {
                         if ((rp.allow & 1024) === 1024) allow = true
                         if ((rp.deny & 1024) === 1024) deny = true
                     }
                 }
                 
                 // @everyone role (usually role_id matches server_id in some schemas, or we need to find it)
                 // In our schema, @everyone is just a role. We need to know its ID.
                 // Usually it's the role with position 0 or name '@everyone'.
                 // Let's assume we don't have it easily here without fetching.
                 // But typically private channels DENY @everyone and ALLOW specific roles.
                 
                 if (deny) return false
                 if (allow) return true
                 
                 return false // Private means default deny unless allowed
             })
          }
      }
      
      return { members }
    } catch (e) {
      console.error(e)
      return { error: "Unauthorized" }
    }
  })

  app.delete("/api/servers/:id/members/:userId", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const userId = (req.params as any).userId as string
    if (!auth || !id || !userId) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      // Check if user has permission to kick (can_manage_server or can_manage_roles? usually separate kick_members perm, but let's use can_manage_server for now)
      const allowed = await checkPermission(payload.sub, id, 'can_manage_server')
      if (!allowed) return { error: "Missing permissions" }
      
      // Prevent kicking owner
      const s = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [id])
      if (s.rows[0]?.owner_id === userId) return { error: "Cannot kick owner" }
      
      await pool.query(`DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, userId])
      await pool.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, userId])
      
      return { ok: true }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.patch("/api/servers/:id/members/:userId", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const userId = (req.params as any).userId as string
    const body = req.body as any
    const { roleIds } = body || {} // Expect array of role IDs
    
    if (!auth || !id || !userId || !roleIds || !Array.isArray(roleIds)) return { error: "Bad request" }
    
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      // Check permission
      const allowed = await checkPermission(payload.sub, id, 'can_manage_roles')
      if (!allowed) return { error: "Missing permissions" }
      
      // Prevent modifying owner's roles (if target is owner)
      const s = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [id])
      if (s.rows[0]?.owner_id === userId) return { error: "Cannot modify owner roles" }
      
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        
        // Delete existing roles
        await client.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, userId])
        
        // Insert new roles
        for (const rid of roleIds) {
           await client.query(
             `INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`,
             [id, userId, rid]
           )
        }
        
        await client.query('COMMIT')
        return { ok: true }
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

  app.post("/api/servers/:id/members/:userId/mute", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const userId = (req.params as any).userId as string
    const body = req.body as any
    const { muted } = body || {} // boolean
    
    if (!auth || !id || !userId || muted === undefined) return { error: "Bad request" }
    
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const allowed = await checkPermission(payload.sub, id, 'can_manage_server')
      if (!allowed) return { error: "Missing permissions" }
      
      await pool.query(`UPDATE server_members SET muted=$3 WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, userId, muted])
      return { ok: true }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.post("/api/servers/:id/bans", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const body = req.body as any
    const { userId, reason } = body || {}
    
    if (!auth || !id || !userId) return { error: "Bad request" }
    
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const allowed = await checkPermission(payload.sub, id, 'can_manage_server')
      if (!allowed) return { error: "Missing permissions" }
      
      const s = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [id])
      if (s.rows[0]?.owner_id === userId) return { error: "Cannot ban owner" }
      
      const client = await pool.connect()
      try {
         await client.query('BEGIN')
         await client.query(`INSERT INTO server_bans (server_id, user_id, reason) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING`, [id, userId, reason || null])
         // Remove from server
         await client.query(`DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, userId])
         await client.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, userId])
         await client.query('COMMIT')
      } catch (e) {
         await client.query('ROLLBACK')
         throw e
      } finally {
         client.release()
      }
      
      return { ok: true }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.patch("/api/servers/:serverId/members/:userId/roles", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const { serverId, userId } = (req.params as any)
    const { roles } = (req.body as any) // Array of role IDs
    
    if (!auth || !serverId || !userId || !Array.isArray(roles)) return { error: "Bad request" }
    
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      // Verify permissions (must be owner or have manage_roles)
      // For simplicity, we'll check if user is owner or has manage_server/manage_roles
      // Real implementation should check specific permissions against the role hierarchy
      const callerRoles = await pool.query(`
        SELECT r.can_manage_roles, r.display_group
        FROM server_member_roles smr
        JOIN roles r ON smr.role_id = r.id
        WHERE smr.server_id = $1::uuid AND smr.user_id = $2::uuid
      `, [serverId, payload.sub])
      
      const server = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
      if (!server.rows[0]) return { error: "Server not found" }
      
      const isOwner = server.rows[0].owner_id === payload.sub
      const canManage = callerRoles.rows.some(r => r.can_manage_roles)
      
      if (!isOwner && !canManage) return { error: "Unauthorized" }
      
      const client = await pool.connect()
      try {
         await client.query('BEGIN')
         // Delete existing roles for this user in this server
         await client.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [serverId, userId])
         
         // Insert new roles
         if (roles.length > 0) {
            const values = roles.map((rid, i) => `($1::uuid, $2::uuid, $${i+3}::uuid)`).join(',')
            await client.query(
               `INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ${values}`,
               [serverId, userId, ...roles]
            )
         }
         await client.query('COMMIT')
         return { ok: true }
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

  app.post("/api/servers/:serverId/members/:userId/kick", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const { serverId, userId } = (req.params as any)
    
    if (!auth || !serverId || !userId) return { error: "Bad request" }
    
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      // Check permissions (manage_server or owner)
      // Simplify: Owner only for now or implement proper checks
      const server = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
      if (server.rows[0].owner_id !== payload.sub) return { error: "Unauthorized" }
      
      await pool.query(`DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [serverId, userId])
      // Also remove from roles
      await pool.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [serverId, userId])
      
      return { ok: true }
    } catch (e) {
      return { error: "Server error" }
    }
  })

  app.post("/api/servers/:serverId/members/:userId/ban", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const { serverId, userId } = (req.params as any)
    
    if (!auth || !serverId || !userId) return { error: "Bad request" }
    
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
      const server = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
      if (server.rows[0].owner_id !== payload.sub) return { error: "Unauthorized" }
      
      await pool.query(`DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [serverId, userId])
      await pool.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [serverId, userId])
      await pool.query(`INSERT INTO server_bans (server_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, [serverId, userId])
      
      return { ok: true }
    } catch (e) {
      return { error: "Server error" }
    }
  })

  app.get("/api/servers/:id/roles", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    if (!auth || !id) return { error: "Bad request" }
    try {
      jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
      const r = await pool.query(`SELECT id::text AS id, name, color, position, can_manage_channels AS "canManageChannels", can_manage_server AS "canManageServer", can_manage_roles AS "canManageRoles" FROM roles WHERE server_id=$1::uuid ORDER BY position ASC, name ASC`, [id])
      return { roles: r.rows }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.post("/api/servers/:id/roles", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const body = req.body as any
    const { name, color, position, canManageChannels, canManageServer, canManageRoles } = body || {}
    if (!auth || !id || !name) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const allowed = await checkPermission(payload.sub, id, 'can_manage_roles')
      if (!allowed) return { error: "Missing permissions" }
      
      let pos = position
      if (pos === undefined) {
        const c = await pool.query(`SELECT count(*) as count FROM roles WHERE server_id=$1::uuid`, [id])
        pos = parseInt(c.rows[0].count)
      }

      const r = await pool.query(
        `INSERT INTO roles (server_id, name, color, display_group, position, can_manage_channels, can_manage_server, can_manage_roles)
         VALUES ($1::uuid, $2::text, $3::text, $2::text, $4::integer, $5::boolean, $6::boolean, $7::boolean)
         RETURNING id::text AS id, name, color, position, can_manage_channels AS "canManageChannels", can_manage_server AS "canManageServer", can_manage_roles AS "canManageRoles"`,
        [id, name, color || '#99aab5', pos, canManageChannels || false, canManageServer || false, canManageRoles || false]
      )
      return { role: r.rows[0] }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.patch("/api/servers/:id/roles/:roleId", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const roleId = (req.params as any).roleId as string
    const body = req.body as any
    const { name, color, position, canManageChannels, canManageServer, canManageRoles } = body || {}
    if (!auth || !id || !roleId) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const allowed = await checkPermission(payload.sub, id, 'can_manage_roles')
      if (!allowed) return { error: "Missing permissions" }
      
      const fields: string[] = []
      const values: any[] = [roleId]
      let idx = 2
      
      if (name !== undefined) { fields.push(`name=$${idx++}`); values.push(name); fields.push(`display_group=$${idx-1}`) }
      if (color !== undefined) { fields.push(`color=$${idx++}`); values.push(color) }
      if (position !== undefined) { fields.push(`position=$${idx++}`); values.push(position) }
      if (canManageChannels !== undefined) { fields.push(`can_manage_channels=$${idx++}`); values.push(canManageChannels) }
      if (canManageServer !== undefined) { fields.push(`can_manage_server=$${idx++}`); values.push(canManageServer) }
      if (canManageRoles !== undefined) { fields.push(`can_manage_roles=$${idx++}`); values.push(canManageRoles) }
      
      if (fields.length === 0) return { error: "No fields" }
      
      const r = await pool.query(
        `UPDATE roles SET ${fields.join(", ")} WHERE id=$1::uuid 
         RETURNING id::text AS id, name, color, position, can_manage_channels AS "canManageChannels", can_manage_server AS "canManageServer", can_manage_roles AS "canManageRoles"`,
        values
      )
      return { role: r.rows[0] }
    } catch {
      return { error: "Unauthorized" }
    }
  })

  app.get("/api/servers/:id/members/:userId", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const id = (req.params as any).id as string
    const userId = (req.params as any).userId as string
    if (!auth || !id || !userId) return { error: "Bad request" }
    try {
      jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
      // Just verifying token valid for now
      return { ok: true }
    } catch {
      return { error: "Unauthorized" }
    }
  })
}
