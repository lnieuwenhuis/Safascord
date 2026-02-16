import bcrypt from "bcryptjs"
import type { FastifyInstance } from "fastify"
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import { pool } from "../lib/db.js"
import { findUserByUsernameOrEmail, signToken } from "../lib/auth.js"

type ShooClaims = JWTPayload & {
  pairwise_sub?: string
  email?: string
  name?: string
  given_name?: string
  family_name?: string
  preferred_username?: string
  picture?: string
}

const SHOO_BASE_URL = (process.env.SHOO_BASE_URL || "https://api.shoo.dev").replace(/\/$/, "")
const SHOO_ISSUER = process.env.SHOO_ISSUER || SHOO_BASE_URL
const SHOO_JWKS_URL = process.env.SHOO_JWKS_URL || `${SHOO_BASE_URL}/.well-known/jwks.json`
const shooJwks = createRemoteJWKSet(new URL(SHOO_JWKS_URL))

function toSafeUsername(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28) || "user"
}

function getShooAudiences() {
  const raw = (process.env.SHOO_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)

  const candidates = new Set<string>(raw)
  candidates.add("http://localhost")
  candidates.add("http://localhost:5173")
  candidates.add("http://127.0.0.1:5173")

  return Array.from(candidates).map((origin) => `origin:${origin}`)
}

const shooAudiences = getShooAudiences()

async function verifyShooIdToken(idToken: string) {
  let lastError: unknown
  for (const aud of shooAudiences) {
    try {
      const verified = await jwtVerify(idToken, shooJwks, {
        issuer: SHOO_ISSUER,
        audience: aud,
      })
      return verified.payload as ShooClaims
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error("Invalid Shoo token")
}

async function nextDiscriminator(username: string) {
  let discrim = Math.floor(Math.random() * 10000).toString().padStart(4, "0")
  let attempts = 0
  while (attempts < 30) {
    const check = await pool.query(`SELECT 1 FROM users WHERE username=$1 AND discriminator=$2`, [username, discrim])
    if (check.rowCount === 0) return discrim
    discrim = Math.floor(Math.random() * 10000).toString().padStart(4, "0")
    attempts++
  }
  return discrim
}

async function ensureUniqueUsername(base: string) {
  let username = toSafeUsername(base)
  let i = 0
  while (i < 50) {
    const candidate = i === 0 ? username : `${username}_${Math.random().toString(36).slice(2, 6)}`
    const check = await pool.query(`SELECT 1 FROM users WHERE username=$1 LIMIT 1`, [candidate])
    if (check.rowCount === 0) return candidate
    i++
  }
  return `user_${Math.random().toString(36).slice(2, 10)}`
}

async function ensureDefaultServerMembership(userId: string) {
  try {
    const server = await pool.query(`SELECT id FROM servers WHERE name='FST [est. 2025]' LIMIT 1`)
    const serverId = server.rows[0]?.id as string | undefined
    if (!serverId) return

    const role = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1`, [serverId])
    const roleId = role.rows[0]?.id as string | undefined

    await pool.query(
      `INSERT INTO server_members (server_id, user_id, role_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid)
       ON CONFLICT DO NOTHING`,
      [serverId, userId, roleId || null]
    )

    if (roleId) {
      await pool.query(
        `INSERT INTO server_member_roles (server_id, user_id, role_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid)
         ON CONFLICT DO NOTHING`,
        [serverId, userId, roleId]
      )
    }
  } catch (err) {
    console.error("Default server membership setup failed:", err)
  }
}

async function findOrCreateShooUser(claims: ShooClaims) {
  const pairwiseSub = claims.pairwise_sub
  if (!pairwiseSub) throw new Error("Missing pairwise_sub in Shoo token")

  const email = claims.email || null
  const displayName = claims.name?.trim()
    || `${claims.given_name || ""} ${claims.family_name || ""}`.trim()
    || claims.preferred_username
    || (email ? email.split("@")[0] : null)
    || `Shoo User ${pairwiseSub.slice(-6)}`
  const avatarUrl = claims.picture || null

  // 1) Primary lookup by Shoo subject
  let existing = await pool.query(
    `SELECT id::text AS id, username, email, display_name, avatar_url
     FROM users
     WHERE shoo_sub=$1
     LIMIT 1`,
    [pairwiseSub]
  )

  // 2) If subject not linked yet, fallback by email and link account
  if (!existing.rowCount && email) {
    const byEmail = await pool.query(
      `SELECT id::text AS id, username, email, display_name, avatar_url
       FROM users
       WHERE email=$1
       LIMIT 1`,
      [email]
    )
    if (byEmail.rowCount) {
      const userId = byEmail.rows[0].id as string
      await pool.query(`UPDATE users SET shoo_sub=$1 WHERE id=$2::uuid`, [pairwiseSub, userId])
      existing = byEmail
    }
  }

  if (existing.rowCount) {
    const user = existing.rows[0] as { id: string; username: string; email: string | null; display_name: string | null; avatar_url: string | null }
    if (!user.display_name || (!user.avatar_url && avatarUrl)) {
      await pool.query(
        `UPDATE users
         SET display_name = COALESCE(display_name, $1),
             avatar_url = COALESCE(avatar_url, $2)
         WHERE id=$3::uuid`,
        [displayName, avatarUrl, user.id]
      )
    }
    return { user, isNew: false }
  }

  const baseUsername = claims.preferred_username || (email ? email.split("@")[0] : `shoo_${pairwiseSub.slice(-8)}`)
  const username = await ensureUniqueUsername(baseUsername)
  const discriminator = await nextDiscriminator(username)

  const created = await pool.query(
    `INSERT INTO users (username, email, password_hash, display_name, avatar_url, discriminator, shoo_sub)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id::text AS id, username, email, display_name, avatar_url`,
    [username, email, "shoo_auth", displayName || username, avatarUrl, discriminator, pairwiseSub]
  )

  const user = created.rows[0] as { id: string; username: string; email: string | null; display_name: string | null; avatar_url: string | null }
  await ensureDefaultServerMembership(user.id)
  return { user, isNew: true }
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/shoo", async (req) => {
    const { idToken } = (req.body || {}) as { idToken?: string }
    if (!idToken) return { error: "Missing idToken" }

    try {
      const claims = await verifyShooIdToken(idToken)
      const { user, isNew } = await findOrCreateShooUser(claims)
      const token = signToken({ id: user.id, username: user.username })
      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.display_name || user.username,
          avatarUrl: user.avatar_url || undefined,
        },
        isNew,
      }
    } catch (err) {
      console.error("Shoo authentication failed:", err)
      return { error: "Authentication failed" }
    }
  })

  app.post("/api/auth/register", async (req) => {
    const body = req.body as any
    const { username, email, password, displayName } = body || {}
    if (!username || !email || !password) return { error: "Missing fields" }

    const discrim = await nextDiscriminator(username)
    const exists = await pool.query("SELECT 1 FROM users WHERE (username=$1 AND discriminator=$2) OR email=$3 LIMIT 1", [username, discrim, email])
    if (exists.rowCount) return { error: "Username+Tag or email already in use" }

    const hash = await bcrypt.hash(String(password), 10)
    const inserted = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, discriminator)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id::text AS id, username, email, display_name, discriminator`,
      [username, email, hash, displayName || username, discrim]
    )

    const user = inserted.rows[0] as { id: string; username: string; email: string; display_name: string }
    await ensureDefaultServerMembership(user.id)

    const token = signToken({ id: user.id, username: user.username })
    return { token, user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name } }
  })

  app.post("/api/auth/login", async (req) => {
    const body = req.body as any
    const { identifier, password } = body || {}
    if (!identifier || !password) return { error: "Missing fields" }

    const user = await findUserByUsernameOrEmail(identifier)
    if (!user) return { error: "Invalid credentials" }

    const ok = await bcrypt.compare(String(password), String(user.password_hash))
    if (!ok) return { error: "Invalid credentials" }

    await ensureDefaultServerMembership(user.id)
    const token = signToken({ id: user.id, username: user.username })
    return { token, user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name } }
  })
}
