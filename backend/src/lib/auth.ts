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
  const server = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
  if (server.rows[0]?.owner_id === userId) return true

  const r = await pool.query(
    `SELECT bool_or(roles.can_manage_channels) as can_manage_channels,
            bool_or(roles.can_manage_server) as can_manage_server,
            bool_or(roles.can_manage_roles) as can_manage_roles
     FROM server_member_roles
     JOIN roles ON roles.id = server_member_roles.role_id 
     WHERE server_member_roles.user_id=$1::uuid AND server_member_roles.server_id=$2::uuid`,
    [userId, serverId]
  )
  const p = r.rows[0]
  if (!p) return false
  if (perm === 'can_manage_channels') return !!p.can_manage_channels
  if (perm === 'can_manage_server') return !!p.can_manage_server
  if (perm === 'can_manage_roles') return !!p.can_manage_roles
  return false
}
