import { FastifyInstance } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { JWT_SECRET } from "../lib/auth.js"

export async function userRoutes(app: FastifyInstance) {
  app.get("/api/me", async (req) => {
    const auth = (req.headers as any).authorization as string | undefined
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      const r = await pool.query(
        `SELECT id::text AS id, username, email, display_name, bio, banner_color, banner_url, avatar_url, status, discriminator, allow_dms_from_strangers AS "allowDmsFromStrangers"
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
        status: u.status,
        discriminator: u.discriminator,
        allowDmsFromStrangers: u.allowDmsFromStrangers
      } }
    } catch {
      return { error: "Unauthorized" }
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
        `SELECT u.id::text AS id, u.username, u.display_name, u.bio, u.banner_color, u.banner_url, u.avatar_url, u.status, u.discriminator, u.allow_dms_from_strangers
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
    const { bio, bannerColor, bannerUrl, avatarUrl, status, username, displayName } = body || {}
    if (!auth) return { error: "Unauthorized" }
    try {
      const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
      
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
      if (status !== undefined) { fields.push(`status=$${idx++}`); values.push(status) }
      if (username !== undefined) { fields.push(`username=$${idx++}`); values.push(username) }
      if (displayName !== undefined) { fields.push(`display_name=$${idx++}`); values.push(displayName) }
      
      if (fields.length === 0) return { error: "No fields" }
      
      values.push(payload.sub)
      const r = await pool.query(
        `UPDATE users SET ${fields.join(", ")} WHERE id=$${idx}::uuid
         RETURNING id::text AS id, username, email, display_name, bio, banner_color, banner_url, avatar_url, status`,
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
        status: u.status
      } }
    } catch {
      return { error: "Unauthorized" }
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
        const serverId = req.query.serverId
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
           SELECT COALESCE(upr.display_group, 'Member') AS title, 
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
           GROUP BY COALESCE(upr.display_group, 'Member')
           ORDER BY min_pos ASC, title`,
          [serverId || null]
        )
        const groups = r.rows as { title: string; users: { username: string; displayName: string; avatarUrl: string; status: string }[] }[]
        return { groups }
      } catch (e) {
        console.error(e)
        return { groups: [] }
      }
    })
}
