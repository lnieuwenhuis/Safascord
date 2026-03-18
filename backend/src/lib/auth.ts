import type { FastifyRequest } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "./db.js"

const DEFAULT_JWT_SECRET = "dev_change_me"
const MIN_JWT_SECRET_LENGTH = 32
const REALTIME_TICKET_AUDIENCE = "realtime"
const REALTIME_TICKET_ISSUER = "api"

export function readJwtSecret() {
  return (process.env.JWT_SECRET || DEFAULT_JWT_SECRET).trim()
}

export function isStrongJwtSecret(secret: string) {
  return secret !== DEFAULT_JWT_SECRET && secret.length >= MIN_JWT_SECRET_LENGTH
}

export const JWT_SECRET = readJwtSecret()

export type AuthenticatedUser = {
  sub: string
  username?: string
  displayName?: string
  avatarUrl?: string
}

export type RealtimeTicketPayload = AuthenticatedUser & {
  scope: "realtime"
  channel: string
}

function readCsvEnv(key: string) {
  return (process.env[key] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

export function isProductionLike() {
  const env = (process.env.NODE_ENV || process.env.APP_ENV || process.env.ENVIRONMENT || "").toLowerCase()
  return env === "production" || env === "staging"
}

export function assertSecureRuntimeConfig() {
  if (!isProductionLike()) return

  if (!isStrongJwtSecret(readJwtSecret())) {
    throw new Error(
      `JWT_SECRET must be set to a strong value with at least ${MIN_JWT_SECRET_LENGTH} characters in production-like environments`,
    )
  }

  if (readCsvEnv("CORS_ORIGINS").length === 0) {
    throw new Error("CORS_ORIGINS must be explicitly configured in production-like environments")
  }

  if (process.env.ENABLE_DEBUG_ROUTES === "true") {
    throw new Error("ENABLE_DEBUG_ROUTES cannot be enabled in production-like environments")
  }
}

export function getBearerToken(header?: string) {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function verifyAuthToken(token: string, jwtSecret = JWT_SECRET): AuthenticatedUser {
  const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload | string
  if (typeof payload === "string" || typeof payload.sub !== "string") {
    throw new Error("Invalid token payload")
  }
  return {
    sub: payload.sub,
    username: typeof payload.username === "string" ? payload.username : undefined,
    displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
    avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : undefined,
  }
}

export function getRequestUser(req: FastifyRequest) {
  const token = getBearerToken((req.headers as Record<string, string | undefined>).authorization)
  if (!token) return null
  try {
    return verifyAuthToken(token)
  } catch {
    return null
  }
}

export async function isAdminUser(user: Pick<AuthenticatedUser, "sub" | "username">) {
  const adminIds = new Set(readCsvEnv("ADMIN_USER_IDS"))
  if (adminIds.has(user.sub)) return true

  if (user.username) {
    const adminUsernames = new Set(readCsvEnv("ADMIN_USERNAMES").map((name) => name.toLowerCase()))
    if (adminUsernames.has(user.username.toLowerCase())) return true
  }

  return false
}

export async function requireAdminUser(req: FastifyRequest) {
  const user = getRequestUser(req)
  if (!user) return null
  return (await isAdminUser(user)) ? user : null
}

export function signToken(user: { id: string; username: string }) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" })
}

export function signRealtimeTicket(user: AuthenticatedUser, channel: string, jwtSecret = JWT_SECRET) {
  return jwt.sign(
    {
      sub: user.sub,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      scope: "realtime",
      channel,
      aud: REALTIME_TICKET_AUDIENCE,
      iss: REALTIME_TICKET_ISSUER,
    },
    jwtSecret,
    { expiresIn: "2m" },
  )
}

export function verifyRealtimeTicket(token: string, jwtSecret = JWT_SECRET): RealtimeTicketPayload {
  const payload = jwt.verify(token, jwtSecret, {
    audience: REALTIME_TICKET_AUDIENCE,
    issuer: REALTIME_TICKET_ISSUER,
  }) as jwt.JwtPayload | string

  if (
    typeof payload === "string" ||
    payload.scope !== "realtime" ||
    typeof payload.sub !== "string" ||
    typeof payload.channel !== "string"
  ) {
    throw new Error("Invalid realtime ticket")
  }

  return {
    sub: payload.sub,
    username: typeof payload.username === "string" ? payload.username : undefined,
    displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
    avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : undefined,
    scope: "realtime",
    channel: payload.channel,
  }
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

export async function isServerMember(userId: string, serverId: string) {
  if (!userId || !serverId) return false
  const result = await pool.query(
    `SELECT 1 FROM server_members WHERE server_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [serverId, userId],
  )
  return (result.rowCount || 0) > 0
}

export async function getChannelAccess(userId: string, channelId: string) {
  const channel = await pool.query(
    `SELECT id::text AS id, server_id::text AS "serverId", type, name
     FROM channels
     WHERE id = $1::uuid
     LIMIT 1`,
    [channelId],
  )

  const row = channel.rows[0] as
    | { id: string; serverId: string | null; type: string; name: string | null }
    | undefined

  if (!row) return null

  if (row.type === "dm") {
    const membership = await pool.query(
      `SELECT 1 FROM channel_members WHERE channel_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
      [channelId, userId],
    )
    return {
      ...row,
      allowed: (membership.rowCount || 0) > 0,
      canSend: (membership.rowCount || 0) > 0,
      muted: false,
      isOwner: false,
      isAdmin: false,
    }
  }

  if (!row.serverId) {
    return {
      ...row,
      allowed: false,
      canSend: false,
      muted: false,
      isOwner: false,
      isAdmin: false,
    }
  }

  const access = await pool.query(
    `SELECT s.owner_id::text AS owner_id,
            sm.muted AS muted,
            EXISTS(
              SELECT 1
              FROM channel_permissions cp_exists
              WHERE cp_exists.channel_id = $1::uuid
            ) AS has_permissions,
            COALESCE(bool_or(cp.can_view), FALSE) AS can_view,
            COALESCE(bool_or(cp.can_send_messages), FALSE) AS can_send,
            COALESCE(bool_or((r.can_manage_server = TRUE) OR (r.can_manage_channels = TRUE)), FALSE) AS is_admin
     FROM servers s
     JOIN server_members sm
       ON sm.server_id = s.id
      AND sm.user_id = $2::uuid
     LEFT JOIN server_member_roles smr
       ON smr.server_id = s.id
      AND smr.user_id = $2::uuid
     LEFT JOIN roles r
       ON r.id = smr.role_id
     LEFT JOIN channel_permissions cp
       ON cp.channel_id = $1::uuid
      AND cp.role_id = smr.role_id
     WHERE s.id = $3::uuid
     GROUP BY s.owner_id, sm.muted`,
    [channelId, userId, row.serverId],
  )

  if (!access.rowCount) {
    return {
      ...row,
      allowed: false,
      canSend: false,
      muted: false,
      isOwner: false,
      isAdmin: false,
    }
  }

  const guard = access.rows[0] as {
    owner_id: string
    muted: boolean
    has_permissions: boolean
    can_view: boolean
    can_send: boolean
    is_admin: boolean
  }

  const isOwner = guard.owner_id === userId
  const allowed = isOwner || guard.is_admin || !guard.has_permissions || guard.can_view
  const canSend = allowed && !guard.muted && (isOwner || guard.is_admin || !guard.has_permissions || guard.can_send)

  return {
    ...row,
    allowed,
    canSend,
    muted: !!guard.muted,
    isOwner,
    isAdmin: !!guard.is_admin,
  }
}
