import jwt from "jsonwebtoken"
import { pool } from "./db.js"

export const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me"

export function signToken(user: { id: string; username: string }) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" })
}

export async function findUserByUsernameOrEmail(identifier: string) {
  console.log("Finding user by:", identifier)
  let username = identifier
  let discriminator: string | undefined
  
  if (identifier.includes("#")) {
     const parts = identifier.split("#")
     username = parts[0]
     discriminator = parts[1]
  }
  
  const r = await pool.query(
    `SELECT id::text AS id, username, email, display_name, password_hash, discriminator
     FROM users
     WHERE (username = $1 AND ($2::text IS NULL OR discriminator = $2::text)) OR email = $3
     LIMIT 1`,
    [username, discriminator || null, identifier]
  )
  return r.rows[0] as { id: string; username: string; email: string | null; display_name: string | null; password_hash: string; discriminator: string } | undefined
}

export async function checkPermission(userId: string, serverId: string, perm: string) {
  if (!userId || !serverId) return false
  const r = await pool.query(
    `SELECT (s.owner_id = $1::uuid) AS is_owner,
            COALESCE(bool_or(r.can_manage_channels), FALSE) AS can_manage_channels,
            COALESCE(bool_or(r.can_manage_server), FALSE) AS can_manage_server,
            COALESCE(bool_or(r.can_manage_roles), FALSE) AS can_manage_roles
     FROM servers s
     LEFT JOIN server_member_roles smr
       ON smr.server_id = s.id
      AND smr.user_id = $1::uuid
     LEFT JOIN roles r
       ON r.id = smr.role_id
     WHERE s.id = $2::uuid
     GROUP BY s.owner_id`,
    [userId, serverId]
  )
  const p = r.rows[0]
  if (!p) return false
  if (p.is_owner) return true
  if (perm === 'can_manage_channels') return !!p.can_manage_channels
  if (perm === 'can_manage_server') return !!p.can_manage_server
  if (perm === 'can_manage_roles') return !!p.can_manage_roles
  return false
}
