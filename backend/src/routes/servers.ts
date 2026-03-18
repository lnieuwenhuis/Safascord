import { FastifyInstance } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { JWT_SECRET, checkPermission, getRequestUser, isServerMember } from "../lib/auth.js"

type RoleManagementContext = {
  ownerId: string
  isOwner: boolean
  isMember: boolean
  canManageRoles: boolean
  canManageServer: boolean
  canManageChannels: boolean
  highestRolePosition: number | null
}

type ServerRoleRow = {
  id: string
  name: string
  position: number
  can_manage_channels: boolean
  can_manage_server: boolean
  can_manage_roles: boolean
}

async function getRoleManagementContext(serverId: string, userId: string): Promise<RoleManagementContext | null> {
  const server = await pool.query(`SELECT owner_id::text AS owner_id FROM servers WHERE id = $1::uuid LIMIT 1`, [serverId])
  const ownerId = String(server.rows[0]?.owner_id || "")
  if (!ownerId) return null

  const member = await isServerMember(userId, serverId)
  const isOwner = ownerId === userId

  const summary = await pool.query(
    `SELECT COALESCE(bool_or(r.can_manage_roles), FALSE) AS can_manage_roles,
            COALESCE(bool_or(r.can_manage_server), FALSE) AS can_manage_server,
            COALESCE(bool_or(r.can_manage_channels), FALSE) AS can_manage_channels,
            MIN(r.position) AS highest_role_position
     FROM server_member_roles smr
     JOIN roles r ON r.id = smr.role_id
     WHERE smr.server_id = $1::uuid
       AND smr.user_id = $2::uuid`,
    [serverId, userId],
  )

  const row = summary.rows[0] as {
    can_manage_roles: boolean
    can_manage_server: boolean
    can_manage_channels: boolean
    highest_role_position: number | null
  }

  return {
    ownerId,
    isOwner,
    isMember: member,
    canManageRoles: !!row?.can_manage_roles,
    canManageServer: !!row?.can_manage_server,
    canManageChannels: !!row?.can_manage_channels,
    highestRolePosition: row?.highest_role_position == null ? null : Number(row.highest_role_position),
  }
}

function canManageRolePosition(context: RoleManagementContext, position: number) {
  if (context.isOwner) return true
  if (context.highestRolePosition == null) return false
  return position > context.highestRolePosition
}

function canGrantRequestedPermissions(
  context: RoleManagementContext,
  requested: { canManageChannels?: boolean; canManageServer?: boolean; canManageRoles?: boolean },
) {
  if (context.isOwner) return true
  if (requested.canManageChannels && !context.canManageChannels) return false
  if (requested.canManageServer && !context.canManageServer) return false
  if (requested.canManageRoles && !context.canManageRoles) return false
  return true
}

async function getServerRoles(serverId: string, roleIds: string[]) {
  if (roleIds.length === 0) return []
  const result = await pool.query(
    `SELECT id::text AS id, name, position, can_manage_channels, can_manage_server, can_manage_roles
     FROM roles
     WHERE server_id = $1::uuid
       AND id = ANY($2::uuid[])`,
    [serverId, roleIds],
  )
  return result.rows as ServerRoleRow[]
}

async function getMemberHighestRolePosition(serverId: string, userId: string) {
  const result = await pool.query(
    `SELECT MIN(r.position) AS highest_role_position
     FROM server_member_roles smr
     JOIN roles r ON r.id = smr.role_id
     WHERE smr.server_id = $1::uuid
       AND smr.user_id = $2::uuid`,
    [serverId, userId],
  )
  const value = result.rows[0]?.highest_role_position
  return value == null ? null : Number(value)
}

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
       const client = await pool.connect()
       try {
         await client.query("BEGIN")

         const r = await client.query(
           `SELECT i.*, s.name as server_name
            FROM invites i
            JOIN servers s ON s.id = i.server_id
            WHERE i.code = $1
            FOR UPDATE`,
           [code],
         )
         if (!r.rowCount) {
           await client.query("ROLLBACK")
           return { error: "Invite not found" }
         }
         const invite = r.rows[0]

         if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
           await client.query("ROLLBACK")
           return { error: "Invite expired" }
         }
         if (invite.max_uses && invite.uses >= invite.max_uses) {
           await client.query("ROLLBACK")
           return { error: "Invite max uses reached" }
         }

         const banned = await client.query(`SELECT 1 FROM server_bans WHERE server_id=$1::uuid AND user_id=$2::uuid`, [invite.server_id, payload.sub])
         if (banned.rowCount) {
           await client.query("ROLLBACK")
           return { error: "You are banned from this server" }
         }

         const existing = await client.query(`SELECT 1 FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [invite.server_id, payload.sub])
         if (existing.rowCount) {
           await client.query("COMMIT")
           return { success: true, serverId: invite.server_id }
         }

         const role = await client.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1`, [invite.server_id])
         let roleId = role.rows[0]?.id
         if (!roleId) {
           const anyRole = await client.query(`SELECT id FROM roles WHERE server_id=$1::uuid ORDER BY position DESC LIMIT 1`, [invite.server_id])
           roleId = anyRole.rows[0]?.id
         }

         await client.query(`INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [invite.server_id, payload.sub, roleId])
         await client.query(`INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`, [invite.server_id, payload.sub, roleId])
         await client.query(`UPDATE invites SET uses = uses + 1 WHERE code=$1`, [code])
         await client.query("COMMIT")
         return { success: true, serverId: invite.server_id }
       } catch (error) {
         await client.query("ROLLBACK")
         throw error
       } finally {
         client.release()
       }
     } catch (e) {
       console.error(e)
       return { error: "Error joining server" }
     }
  })

  app.get("/api/servers/:id/members", async (req) => {
    const user = getRequestUser(req)
    const id = (req.params as any).id as string
    const channelId = (req.query as any).channelId as string | undefined
    if (!user || !id) return { error: "Bad request" }
    try {
      const member = await isServerMember(user.sub, id)
      if (!member) return { error: "Forbidden" }

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
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (!uuidRegex.test(channelId)) return { members }

        const [channelRes, permsRes, ownerRes, adminRolesRes] = await Promise.all([
          pool.query(
            `SELECT id::text AS id
             FROM channels
             WHERE id = $1::uuid AND server_id = $2::uuid
             LIMIT 1`,
            [channelId, id]
          ),
          pool.query(
            `SELECT role_id::text AS role_id, can_view
             FROM channel_permissions
             WHERE channel_id = $1::uuid`,
            [channelId]
          ),
          pool.query(`SELECT owner_id::text AS owner_id FROM servers WHERE id = $1::uuid LIMIT 1`, [id]),
          pool.query(
            `SELECT id::text AS id
             FROM roles
             WHERE server_id = $1::uuid
               AND (can_manage_server = TRUE OR can_manage_channels = TRUE)`,
            [id]
          ),
        ])

        if (!channelRes.rowCount) return { members: [] }

        const perms = permsRes.rows as { role_id: string; can_view: boolean }[]
        if (perms.length > 0) {
          const ownerId = String(ownerRes.rows[0]?.owner_id || "")
          const adminRoleIds = new Set((adminRolesRes.rows as { id: string }[]).map((row) => String(row.id)))
          const allowedRoleIds = new Set(
            perms
              .filter((row) => !!row.can_view)
              .map((row) => String(row.role_id))
          )

          members = members.filter((member) => {
            if (member.id === ownerId) return true
            const roleIds = (member.roles as string[]).map((x) => String(x))
            if (roleIds.some((roleId) => adminRoleIds.has(roleId))) return true
            return roleIds.some((roleId) => allowedRoleIds.has(roleId))
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
      const context = await getRoleManagementContext(id, payload.sub)
      if (!context?.isMember || (!context.isOwner && !context.canManageRoles)) return { error: "Missing permissions" }
      if (context.ownerId === userId) return { error: "Cannot modify owner roles" }

      const targetHighestRolePosition = await getMemberHighestRolePosition(id, userId)
      if (!context.isOwner && targetHighestRolePosition != null && !canManageRolePosition(context, targetHighestRolePosition)) {
        return { error: "Cannot modify a member with an equal or higher role" }
      }

      const uniqueRoleIds = [...new Set(roleIds.map((roleId: string) => String(roleId)))]
      const roleRows = await getServerRoles(id, uniqueRoleIds)
      if (roleRows.length !== uniqueRoleIds.length) return { error: "Invalid role selection" }
      if (roleRows.some((role) => role.name === "Owner")) return { error: "Owner role cannot be assigned" }
      if (roleRows.some((role) => !canManageRolePosition(context, Number(role.position)))) {
        return { error: "Cannot assign a role above or equal to your highest role" }
      }
      if (roleRows.some((role) => !canGrantRequestedPermissions(context, {
        canManageChannels: role.can_manage_channels,
        canManageServer: role.can_manage_server,
        canManageRoles: role.can_manage_roles,
      }))) {
        return { error: "Cannot assign a role with permissions you do not hold" }
      }
      
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        
        // Delete existing roles
        await client.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [id, userId])
        
        // Insert new roles
        for (const rid of uniqueRoleIds) {
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
      const context = await getRoleManagementContext(serverId, payload.sub)
      if (!context?.isMember || (!context.isOwner && !context.canManageRoles)) return { error: "Unauthorized" }
      if (context.ownerId === userId) return { error: "Cannot modify owner roles" }

      const targetHighestRolePosition = await getMemberHighestRolePosition(serverId, userId)
      if (!context.isOwner && targetHighestRolePosition != null && !canManageRolePosition(context, targetHighestRolePosition)) {
        return { error: "Cannot modify a member with an equal or higher role" }
      }

      const uniqueRoles = [...new Set(roles.map((roleId) => String(roleId)))]
      const roleRows = await getServerRoles(serverId, uniqueRoles)
      if (roleRows.length !== uniqueRoles.length) return { error: "Invalid role selection" }
      if (roleRows.some((role) => role.name === "Owner")) return { error: "Owner role cannot be assigned" }
      if (roleRows.some((role) => !canManageRolePosition(context, Number(role.position)))) {
        return { error: "Cannot assign a role above or equal to your highest role" }
      }
      if (roleRows.some((role) => !canGrantRequestedPermissions(context, {
        canManageChannels: role.can_manage_channels,
        canManageServer: role.can_manage_server,
        canManageRoles: role.can_manage_roles,
      }))) {
        return { error: "Cannot assign a role with permissions you do not hold" }
      }
      
      const client = await pool.connect()
      try {
         await client.query('BEGIN')
         // Delete existing roles for this user in this server
         await client.query(`DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid`, [serverId, userId])
         
         // Insert new roles
         if (uniqueRoles.length > 0) {
            const values = uniqueRoles.map((rid, i) => `($1::uuid, $2::uuid, $${i+3}::uuid)`).join(',')
            await client.query(
               `INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ${values}`,
               [serverId, userId, ...uniqueRoles]
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
    const user = getRequestUser(req)
    const id = (req.params as any).id as string
    if (!user || !id) return { error: "Bad request" }
    try {
      const member = await isServerMember(user.sub, id)
      if (!member) return { error: "Forbidden" }
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
    if (String(name).trim().toLowerCase() === "owner") return { error: "Reserved role name" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const context = await getRoleManagementContext(id, payload.sub)
      if (!context?.isMember || (!context.isOwner && !context.canManageRoles)) return { error: "Missing permissions" }
      
      let pos = position
      if (pos === undefined) {
        const c = await pool.query(`SELECT count(*) as count FROM roles WHERE server_id=$1::uuid`, [id])
        pos = parseInt(c.rows[0].count)
      }
      if (!Number.isInteger(pos) || pos < 0) return { error: "Invalid role position" }
      if (!canManageRolePosition(context, pos)) return { error: "Cannot create role above or equal to your highest role" }
      if (!canGrantRequestedPermissions(context, { canManageChannels, canManageServer, canManageRoles })) {
        return { error: "Cannot grant permissions you do not hold" }
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
    if (name !== undefined && String(name).trim().toLowerCase() === "owner") return { error: "Reserved role name" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const context = await getRoleManagementContext(id, payload.sub)
      if (!context?.isMember || (!context.isOwner && !context.canManageRoles)) return { error: "Missing permissions" }

      const targetRoleResult = await pool.query(
        `SELECT id::text AS id, name, position
         FROM roles
         WHERE id = $1::uuid
           AND server_id = $2::uuid
         LIMIT 1`,
        [roleId, id],
      )
      const targetRole = targetRoleResult.rows[0] as { id: string; name: string; position: number } | undefined
      if (!targetRole) return { error: "Not found" }
      if (targetRole.name === "Owner") return { error: "Owner role cannot be modified" }
      if (!canManageRolePosition(context, Number(targetRole.position))) {
        return { error: "Cannot modify a role above or equal to your highest role" }
      }
      if (position !== undefined && (!Number.isInteger(position) || position < 0 || !canManageRolePosition(context, position))) {
        return { error: "Invalid role position" }
      }
      if (!canGrantRequestedPermissions(context, { canManageChannels, canManageServer, canManageRoles })) {
        return { error: "Cannot grant permissions you do not hold" }
      }
      
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
    const requester = getRequestUser(req)
    const id = (req.params as any).id as string
    const userId = (req.params as any).userId as string
    if (!requester || !id || !userId) return { error: "Bad request" }
    try {
      const member = await isServerMember(requester.sub, id)
      if (!member) return { error: "Forbidden" }

      const [primaryRoleRes, rolesRes] = await Promise.all([
        pool.query(
          `SELECT r.id::text AS "roleId",
                  r.name AS "roleName",
                  r.color AS "roleColor",
                  r.can_manage_roles AS "canManageRoles",
                  r.position
           FROM server_member_roles smr
           JOIN roles r ON r.id = smr.role_id
           WHERE smr.server_id = $1::uuid
             AND smr.user_id = $2::uuid
           ORDER BY r.position ASC
           LIMIT 1`,
          [id, userId],
        ),
        pool.query(
          `SELECT r.id::text AS id, r.name, r.color, r.position
           FROM server_member_roles smr
           JOIN roles r ON r.id = smr.role_id
           WHERE smr.server_id = $1::uuid
             AND smr.user_id = $2::uuid
           ORDER BY r.position ASC`,
          [id, userId],
        ),
      ])

      const primaryRole = primaryRoleRes.rows[0]
      if (!primaryRole) return { member: null }
      return {
        member: {
          roleId: primaryRole.roleId,
          roleName: primaryRole.roleName,
          roleColor: primaryRole.roleColor,
          canManageRoles: !!primaryRole.canManageRoles,
          roles: rolesRes.rows,
        },
      }
    } catch {
      return { error: "Unauthorized" }
    }
  })
}
