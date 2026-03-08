import { FastifyInstance } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { JWT_SECRET, getRequestUser, isServerMember } from "../lib/auth.js"

const VALID_USER_STATUSES = new Set(["online", "away", "busy", "offline"])

function isSafeProfileUrl(value: unknown) {
  if (value == null || value === "") return true
  if (typeof value !== "string") return false
  if (value.startsWith("/api/uploads/")) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export async function userRoutes(app: FastifyInstance) {
  app.get("/api/me", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }

    let payload: any
    try {
      payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    } catch {
      return { error: "Unauthorized" }
    }

    try {
      const r = await pool.query(
        `SELECT id::text AS id, username, email, display_name, bio, banner_color, banner_url, avatar_url, custom_background_url, custom_background_opacity, status, discriminator, allow_dms_from_strangers AS "allowDmsFromStrangers", notifications_quiet_mode AS "notificationsQuietMode"
         FROM users WHERE id = $1::uuid`,
        [payload.sub]
      )
      const u = r.rows[0]
      if (!u) return { error: "Unauthorized" }
      return { user: { 
        id: u.id, 
        username: u.username, 
        email: u.email, 
        displayName: u.display_name,
        bio: u.bio,
        bannerColor: u.banner_color,
        bannerUrl: u.banner_url,
        avatarUrl: u.avatar_url,
        customBackgroundUrl: u.custom_background_url,
        customBackgroundOpacity: u.custom_background_opacity,
        status: u.status,
        discriminator: u.discriminator,
        allowDmsFromStrangers: u.allowDmsFromStrangers,
        notificationsQuietMode: u.notificationsQuietMode
      } }
    } catch (e) {
      console.error("GET /api/me error:", e)
      return { error: "Failed to load profile" }
    }
  })

  app.get("/api/users/:id/profile", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    const id = (req.params as any).id as string
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const requesterId = payload.sub

      const r = await pool.query(
        `SELECT u.id::text AS id, u.username, u.display_name, u.bio, u.banner_color, u.banner_url, u.avatar_url, u.custom_background_url, u.status, u.discriminator, u.allow_dms_from_strangers
         FROM users u WHERE u.id = $1::uuid`,
        [id]
      )
      const u = r.rows[0]
      if (!u) return { error: "User not found" }

      let friendshipStatus = 'none'
      let friendRequestId: string | undefined
      if (requesterId !== u.id) {
          const [id1, id2] = [requesterId, u.id].sort()
          const f = await pool.query(`SELECT id, status, action_user_id FROM friendships WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid`, [id1, id2])
          if (f.rowCount && f.rowCount > 0) {
             const row = f.rows[0]
             if (row.status === 'accepted') friendshipStatus = 'friends'
             else if (row.status === 'pending') {
                friendshipStatus = row.action_user_id === requesterId ? 'outgoing' : 'incoming'
                if (friendshipStatus === 'incoming') {
                   friendRequestId = row.id
                }
             }
             else if (row.status === 'blocked') friendshipStatus = 'blocked'
          }
      }

      return { user: { 
        id: u.id, 
        username: u.username, 
        displayName: u.display_name,
        bio: u.bio,
        bannerColor: u.banner_color,
        bannerUrl: u.banner_url,
        avatarUrl: u.avatar_url,
        customBackgroundUrl: u.custom_background_url,
        status: u.status,
        discriminator: u.discriminator,
        allowDmsFromStrangers: u.allow_dms_from_strangers,
        friendshipStatus,
        friendRequestId
      } }
    } catch (e) {
      console.error(e)
      return { error: "Unauthorized" }
    }
  })

  app.patch("/api/me/profile", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const { bio, bannerColor, bannerUrl, avatarUrl, customBackgroundUrl, customBackgroundOpacity, status, username, displayName } = body || {}
    if (!auth) return { error: "Unauthorized" }

    let payload: any
    try {
      payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    } catch {
      return { error: "Unauthorized" }
    }

    try {
      if (username !== undefined && (typeof username !== "string" || username.length < 2 || username.length > 32 || !/^[a-zA-Z0-9_]+$/.test(username))) {
        return { error: "Invalid username" }
      }
      if (displayName !== undefined && (typeof displayName !== "string" || displayName.length > 64)) {
        return { error: "Invalid display name" }
      }
      if (bio !== undefined && (typeof bio !== "string" || bio.length > 500)) {
        return { error: "Invalid bio" }
      }
      if (status !== undefined && !VALID_USER_STATUSES.has(String(status))) {
        return { error: "Invalid status" }
      }
      if (customBackgroundOpacity !== undefined && (typeof customBackgroundOpacity !== "number" || customBackgroundOpacity < 0 || customBackgroundOpacity > 1)) {
        return { error: "Invalid background opacity" }
      }
      if (!isSafeProfileUrl(bannerUrl) || !isSafeProfileUrl(avatarUrl) || !isSafeProfileUrl(customBackgroundUrl)) {
        return { error: "Invalid profile asset URL" }
      }

      if (username) {
        const check = await pool.query("SELECT 1 FROM users WHERE username=$1 AND id!=$2::uuid LIMIT 1", [username, payload.sub])
        if (check.rowCount && check.rowCount > 0) return { error: "Username taken" }
      }

      const fields: string[] = []
      const values: any[] = []
      let idx = 1
      
      if (bio !== undefined) { fields.push(`bio=$${idx++}`); values.push(bio) }
      if (bannerColor !== undefined) { fields.push(`banner_color=$${idx++}`); values.push(bannerColor) }
      if (bannerUrl !== undefined) { fields.push(`banner_url=$${idx++}`); values.push(bannerUrl) }
      if (avatarUrl !== undefined) { fields.push(`avatar_url=$${idx++}`); values.push(avatarUrl) }
      if (customBackgroundUrl !== undefined) { fields.push(`custom_background_url=$${idx++}`); values.push(customBackgroundUrl) }
      if (customBackgroundOpacity !== undefined) { fields.push(`custom_background_opacity=$${idx++}`); values.push(customBackgroundOpacity) }
      if (status !== undefined) { fields.push(`status=$${idx++}`); values.push(status) }
      if (username !== undefined) { fields.push(`username=$${idx++}`); values.push(username) }
      if (displayName !== undefined) { fields.push(`display_name=$${idx++}`); values.push(displayName) }
      
      // Settings
      if (body.notificationsQuietMode !== undefined) {
         fields.push(`notifications_quiet_mode=$${idx++}`)
         values.push(body.notificationsQuietMode)
      }
      
      if (fields.length === 0) return { error: "No fields" }
      
      values.push(payload.sub)
      const r = await pool.query(
        `UPDATE users SET ${fields.join(", ")} WHERE id=$${idx}::uuid
         RETURNING id::text AS id, username, email, display_name, bio, banner_color, banner_url, avatar_url, custom_background_url, custom_background_opacity, status, notifications_quiet_mode AS "notificationsQuietMode"`,
        values
      )
      const u = r.rows[0]
      return { user: { 
        id: u.id, 
        username: u.username, 
        email: u.email, 
        displayName: u.display_name,
        bio: u.bio,
        bannerColor: u.banner_color,
        bannerUrl: u.banner_url,
        avatarUrl: u.avatar_url,
        customBackgroundUrl: u.custom_background_url,
        customBackgroundOpacity: u.custom_background_opacity,
        status: u.status,
        notificationsQuietMode: u.notificationsQuietMode
      } }
    } catch (e) {
      console.error("PATCH /api/me/profile error:", e)
      return { error: "Failed to update profile" }
    }
  })

  app.patch("/api/me/display-name", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    const body = req.body as any
    const { displayName } = body || {}
    if (!auth || !displayName) return { error: "Bad request" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const r = await pool.query(
        `UPDATE users SET display_name=$2 WHERE id=$1::uuid
         RETURNING id::text AS id, username, email, display_name`,
        [payload.sub, displayName]
      )
      const u = r.rows[0]
      return { user: { id: u.id, username: u.username, email: u.email, displayName: u.display_name } }
    } catch {
      return { error: "Unauthorized" }
    }
  })
  
  app.get("/api/users", async (req: any) => {
      try {
        const user = getRequestUser(req)
        const serverId = req.query.serverId
        if (!user || !serverId) return { groups: [] }
        const member = await isServerMember(user.sub, serverId)
        if (!member) return { groups: [] }
        const r = await pool.query(
          `WITH user_primary_role AS (
             SELECT 
               sm.user_id,
               sm.server_id,
               (
                 SELECT r.display_group 
                 FROM server_member_roles smr
                 JOIN roles r ON r.id = smr.role_id
                 WHERE smr.user_id = sm.user_id AND smr.server_id = sm.server_id
                 ORDER BY r.position ASC 
                 LIMIT 1
               ) as display_group,
               (
                 SELECT r.color 
                 FROM server_member_roles smr
                 JOIN roles r ON r.id = smr.role_id
                 WHERE smr.user_id = sm.user_id AND smr.server_id = sm.server_id
                 ORDER BY r.position ASC 
                 LIMIT 1
               ) as color,
               (
                 SELECT min(r.position)
                 FROM server_member_roles smr
                 JOIN roles r ON r.id = smr.role_id
                 WHERE smr.user_id = sm.user_id AND smr.server_id = sm.server_id
               ) as position
             FROM server_members sm
             WHERE ($1::uuid IS NULL OR sm.server_id = $1::uuid)
           )
           SELECT COALESCE(upr.display_group, 'Users') AS title, 
                  json_agg(json_build_object(
                    'id', users.id,
                    'username', users.username, 
                    'displayName', users.display_name, 
                    'avatarUrl', users.avatar_url,
                    'status', users.status,
                    'roleColor', upr.color
                  ) ORDER BY users.username) AS users,
                  MIN(upr.position) as min_pos
           FROM user_primary_role upr
           JOIN users ON users.id = upr.user_id
           GROUP BY COALESCE(upr.display_group, 'Users')
           ORDER BY min_pos ASC, title`,
          [serverId]
        )
        const groups = r.rows as { title: string; users: { username: string; displayName: string; avatarUrl: string; status: string }[] }[]
        return { groups }
      } catch (e) {
        console.error(e)
        return { groups: [] }
      }
    })
}
