import Fastify, { FastifyRequest } from "fastify"
import cors from "@fastify/cors"
import fastifyStatic from "@fastify/static"
import fastifyMultipart from "@fastify/multipart"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import Redis from "ioredis"
import path from "path"
import fs from "fs"
import { pipeline } from "stream"
import util from "util"
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { WorkOS } from '@workos-inc/node'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pump = util.promisify(pipeline)

const app = Fastify({ logger: true })
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379")

const workos = new WorkOS(process.env.WORKOS_API_KEY)
const clientId = process.env.WORKOS_CLIENT_ID || ""

async function start() {
  await app.register(cors, {
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  })
  await app.register(fastifyMultipart)
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '../uploads'),
    prefix: '/api/uploads/',
  })

  // Migrations
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_color TEXT DEFAULT '#000000';`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'online';`)
    await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS description TEXT;`)
    await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS icon_url TEXT;`)
    await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS banner_url TEXT;`)
    await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#99aab5';`)
    await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_manage_channels BOOLEAN DEFAULT FALSE;`)
    await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_manage_server BOOLEAN DEFAULT FALSE;`)
    await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_manage_roles BOOLEAN DEFAULT FALSE;`)
    await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;`)
    
    // Backfill roles for existing servers
    const servers = await pool.query(`SELECT id, owner_id FROM servers`)
    for (const s of servers.rows) {
       const roles = await pool.query(`SELECT id, name FROM roles WHERE server_id=$1::uuid`, [s.id])
       let ownerRoleId = roles.rows.find(r => r.name === 'Owner')?.id
       let memberRoleId = roles.rows.find(r => r.name === 'Member')?.id
       
       if (!ownerRoleId) {
           const r = await pool.query(`INSERT INTO roles (server_id, name, color, display_group, can_manage_channels, can_manage_server, can_manage_roles) VALUES ($1::uuid, 'Owner', '#ff0000', 'Owner', true, true, true) RETURNING id`, [s.id])
           ownerRoleId = r.rows[0].id
       }
       if (!memberRoleId) {
           const r = await pool.query(`INSERT INTO roles (server_id, name, color, display_group, can_manage_channels, can_manage_server, can_manage_roles) VALUES ($1::uuid, 'Member', '#99aab5', 'Member', false, false, false) RETURNING id`, [s.id])
           memberRoleId = r.rows[0].id
       }
       
       // Assign Owner role to owner if missing
       await pool.query(`UPDATE server_members SET role_id=$1::uuid WHERE server_id=$2::uuid AND user_id=$3::uuid AND role_id IS NULL`, [ownerRoleId, s.id, s.owner_id])
       
       // Assign Member role to others if missing
       await pool.query(`UPDATE server_members SET role_id=$1::uuid WHERE server_id=$2::uuid AND user_id!=$3::uuid AND role_id IS NULL`, [memberRoleId, s.id, s.owner_id])
    }
  } catch (e) {
    console.error("Migration failed", e)
  }
}

app.get("/api/health", async () => ({ ok: true }))

app.get("/api/debug/db", async () => {
  try {
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
    // Use try-catch for users query in case table doesn't exist
    let users = { rows: [] }
    try {
      users = await pool.query(`SELECT * FROM users LIMIT 5`)
    } catch (e) { console.error("Error querying users:", e) }
    
    const usersCols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users'`)
    return { 
      tables: tables.rows, 
      users: users.rows,
      userColumns: usersCols.rows
    }
  } catch (e) {
    return { error: String(e) }
  }
})

app.post("/api/debug/migrate", async () => {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_color TEXT DEFAULT '#000000';`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'online';`)
    await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS description TEXT;`)
    await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS icon_url TEXT;`)
    await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS banner_url TEXT;`)
    return { ok: true }
  } catch (e) {
    return { error: String(e) }
  }
})

app.post("/api/upload", async (req, reply) => {
  const data = await req.file()
  if (!data) return { error: "No file" }
  const ext = path.extname(data.filename)
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
  const uploadsDir = path.join(__dirname, '../uploads')
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true })
  }
  const filepath = path.join(uploadsDir, name)
  await pump(data.file, fs.createWriteStream(filepath))
  const url = `/api/uploads/${name}`
  return { url }
})

app.get("/api/auth/workos-url", async (req) => {
  const { redirectUri } = req.query as any
  if (!redirectUri) return { error: "Missing redirectUri" }
  const url = workos.userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId,
    redirectUri,
  })
  return { url }
})

app.post("/api/auth/workos-callback", async (req) => {
  const { code } = req.body as any
  console.log("WorkOS Callback received code:", code ? "Yes" : "No")
  if (!code) return { error: "Missing code" }
  try {
    const { user } = await workos.userManagement.authenticateWithCode({
      clientId,
      code,
    })
    
    console.log("WorkOS Authenticated user:", user.email, user.id)
    
    const email = user.email
    if (!email) return { error: "No email from provider" }
    
    let dbUser = await findUserByUsernameOrEmail(email)
    console.log("DB User found:", dbUser ? dbUser.id : "None")
    
    let isNew = false
    if (!dbUser) {
      isNew = true
      console.log("Creating new user for email:", email)
      let username = email.split('@')[0]
      const check = await pool.query("SELECT 1 FROM users WHERE username=$1 LIMIT 1", [username])
      if (check.rowCount && check.rowCount > 0) {
        username = `${username}_${Math.random().toString(36).slice(2, 6)}`
      }
      
      const passwordHash = "workos_auth" 
      const displayName = user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : username
      
      console.log("Inserting user:", username, email)
      const r = await pool.query(
        `INSERT INTO users (username, email, password_hash, display_name, avatar_url)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id::text AS id, username, email, display_name`,
        [username, email, passwordHash, displayName, user.profilePictureUrl || null]
      )
      
      const u = r.rows[0]
      console.log("User created:", u)
      try {
        const sr = await pool.query(`SELECT id FROM servers WHERE name='FST [est. 2025]' LIMIT 1`)
        const sid = sr.rows[0]?.id as string | undefined
        if (sid) {
           const rr = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1`, [sid])
           const rid = rr.rows[0]?.id as string | undefined
           await pool.query(`INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, [sid, u.id, rid || null])
        }
      } catch (err) {
         console.error("Error adding to default server:", err)
      }
      
      dbUser = { ...u, password_hash: passwordHash }
    }
    
    if (!dbUser) return { error: "User not found" }
    const token = signToken({ id: dbUser.id, username: dbUser.username })
    console.log("Token generated for user:", dbUser.id)
    return { token, user: { id: dbUser.id, username: dbUser.username, email: dbUser.email, displayName: dbUser.display_name }, isNew }
    
  } catch (e) {
    console.error("WorkOS Callback Error:", e)
    return { error: "Authentication failed" }
  }
})

app.post("/api/auth/register", async (req) => {
  const body = req.body as any
  const { username, email, password, displayName } = body || {}
  if (!username || !email || !password) return { error: "Missing fields" }
  const exists = await pool.query("SELECT 1 FROM users WHERE username=$1 OR email=$2 LIMIT 1", [username, email])
  if (exists.rowCount) return { error: "Username or email already in use" }
  const hash = await bcrypt.hash(String(password), 10)
  const r = await pool.query(
    `INSERT INTO users (username, email, password_hash, display_name)
     VALUES ($1,$2,$3,$4)
     RETURNING id::text AS id, username, email, display_name`,
    [username, email, hash, displayName || username]
  )
  const user = r.rows[0] as { id: string; username: string; email: string; display_name: string }
  try {
    const sr = await pool.query(`SELECT id FROM servers WHERE name='FST [est. 2025]' LIMIT 1`)
    const sid = sr.rows[0]?.id as string | undefined
    if (sid) {
      const rr = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1`, [sid])
      const rid = rr.rows[0]?.id as string | undefined
      await pool.query(`INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, [sid, user.id, rid || null])
    }
  } catch {}
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
  const token = signToken({ id: user.id, username: user.username })
  try {
    const mr = await pool.query(`SELECT 1 FROM server_members WHERE user_id=$1::uuid LIMIT 1`, [user.id])
    if (mr.rowCount === 0) {
      const sr = await pool.query(`SELECT id FROM servers WHERE name='FST [est. 2025]' LIMIT 1`)
      const sid = sr.rows[0]?.id as string | undefined
      if (sid) {
         const rr = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1`, [sid])
         const rid = rr.rows[0]?.id as string | undefined
         await pool.query(`INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, [sid, user.id, rid || null])
      }
    }
  } catch {}
  return { token, user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name } }
})

app.get("/api/me", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  if (!auth) return { error: "Unauthorized" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const r = await pool.query(
      `SELECT id::text AS id, username, email, display_name, bio, banner_color, banner_url, avatar_url, status
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
      status: u.status
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
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
    const r = await pool.query(
      `SELECT id::text AS id, username, display_name, bio, banner_color, banner_url, avatar_url, status
       FROM users WHERE id = $1::uuid`,
      [id]
    )
    const u = r.rows[0]
    if (!u) return { error: "User not found" }
    return { user: { 
      id: u.id, 
      username: u.username, 
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me"

function signToken(user: { id: string; username: string }) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" })
}

async function findUserByUsernameOrEmail(identifier: string) {
  console.log("Finding user by:", identifier)
  const r = await pool.query(
    `SELECT id::text AS id, username, email, display_name, password_hash
     FROM users
     WHERE username = $1 OR email = $1
     LIMIT 1`,
    [identifier]
  )
  return r.rows[0] as { id: string; username: string; email: string | null; display_name: string | null; password_hash: string } | undefined
}

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

app.post("/api/channels", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const body = req.body as any
  const { serverId, name, category } = body || {}
  if (!auth || !serverId || !name || !category) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const allowed = await checkPermission(payload.sub, serverId, 'can_manage_channels')
    if (!allowed) return { error: "Missing permissions" }
    const r = await pool.query(
      `INSERT INTO channels (server_id, name, category) VALUES ($1::uuid,$2::text,$3::text)
       RETURNING id::text AS id, name, category`,
      [serverId, name, category]
    )
    return { channel: r.rows[0] as { id: string; name: string; category: string } }
  } catch {
    return { error: "Unauthorized" }
  }
})

app.patch("/api/channels/:id", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const body = req.body as any
  const id = (req.params as any).id as string
  const { name } = body || {}
  if (!auth || !id || !name) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const c = await pool.query('SELECT server_id FROM channels WHERE id=$1::uuid', [id])
    const serverId = c.rows[0]?.server_id
    if (!serverId) return { error: "Not found" }
    const allowed = await checkPermission(payload.sub, serverId, 'can_manage_channels')
    if (!allowed) return { error: "Missing permissions" }
    const r = await pool.query(`UPDATE channels SET name=$2 WHERE id=$1::uuid RETURNING id::text AS id, name`, [id, name])
    return { channel: r.rows[0] as { id: string; name: string } }
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
  try {
    const serverId = req.query.serverId || null
    const ch = await pool.query(
      `SELECT name, category FROM channels WHERE ($1::uuid IS NULL OR server_id=$1::uuid) ORDER BY category, name`,
      [serverId]
    )
    const cats = await pool.query(
      `SELECT name FROM channel_categories WHERE ($1::uuid IS NULL OR server_id=$1::uuid) ORDER BY name`,
      [serverId]
    )
    const byCat = new Map<string, string[]>()
    for (const row of ch.rows as { name: string; category: string }[]) {
      const arr = byCat.get(row.category) || []
      arr.push(row.name)
      byCat.set(row.category, arr)
    }
    for (const c of cats.rows as { name: string }[]) {
      if (!byCat.has(c.name)) byCat.set(c.name, [])
    }
    const sections = Array.from(byCat.entries()).map(([title, channels]) => ({ title, channels }))
    sections.sort((a, b) => a.title.localeCompare(b.title))
    return { sections }
  } catch {
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

app.get("/api/users", async (req: FastifyRequest<{ Querystring: { serverId?: string } }>) => {
  try {
    const serverId = req.query.serverId
    const r = await pool.query(
      `SELECT COALESCE(roles.display_group, 'Member') AS title, 
              json_agg(json_build_object(
                'id', users.id,
                'username', users.username, 
                'displayName', users.display_name, 
                'avatarUrl', users.avatar_url,
                'status', users.status,
                'roleColor', roles.color
              ) ORDER BY users.username) AS users
       FROM server_members
       LEFT JOIN roles ON roles.id = server_members.role_id
       JOIN users ON users.id = server_members.user_id
       WHERE ($1::uuid IS NULL OR server_members.server_id = $1::uuid)
       GROUP BY COALESCE(roles.display_group, 'Member')
       ORDER BY COALESCE(MIN(roles.position), 999) ASC, title`,
      [serverId || null]
    )
    const groups = r.rows as { title: string; users: { username: string; displayName: string; avatarUrl: string; status: string }[] }[]
    return { groups }
  } catch {
    const groups = [
      { title: "Admin", users: [{ username: "Dylan", displayName: "Dylan" }, { username: "Koda", displayName: "Koda" }] },
      { title: "Staff", users: [{ username: "Jayden", displayName: "Jayden" }, { username: "Squires", displayName: "Squires" }] },
      { title: "FST", users: [{ username: "Alex", displayName: "Alex" }, { username: "Flubber", displayName: "Flubber" }, { username: "Fraser", displayName: "Fraser" }, { username: "Jack", displayName: "Jack" }, { username: "Sam", displayName: "Sam" }] },
    ]
    return { groups }
  }
})

app.get("/api/messages", async (req: FastifyRequest<{ Querystring: { channel?: string; limit?: string; before?: string } }>) => {
  try {
    const channelName = req.query.channel
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50"), 1), 200)
    const before = req.query.before || null
    const r = await pool.query(
      `SELECT messages.id::text AS id, 
              COALESCE(users.display_name, users.username) AS user, 
              users.avatar_url AS user_avatar,
              users.id::text AS user_id,
              messages.content AS text, 
              messages.created_at AS ts,
              roles.color AS role_color
       FROM messages
       JOIN channels ON channels.id = messages.channel_id
       LEFT JOIN users ON users.id = messages.user_id
       LEFT JOIN server_members ON server_members.user_id = messages.user_id AND server_members.server_id = channels.server_id
       LEFT JOIN roles ON roles.id = server_members.role_id
       WHERE ($1::text IS NULL OR channels.name = $1::text)
         AND ($2::timestamptz IS NULL OR messages.created_at < $2::timestamptz)
       ORDER BY messages.created_at DESC
       LIMIT $3`,
      [channelName || null, before, limit]
    )
    const rows = r.rows as { id: string; user: string | null; user_avatar: string | null; user_id: string | null; text: string; ts: string; role_color: string | null }[]
    return { messages: rows.reverse().map(m => ({ id: m.id, user: m.user ?? "User", userAvatar: m.user_avatar, userId: m.user_id, text: m.text, ts: m.ts, roleColor: m.role_color || undefined })) }
  } catch (e) {
    console.error("GET /api/messages error:", e)
    const messages = Array.from({ length: 24 }).map((_, i) => ({ id: String(i), user: `User ${i % 5}`, text: `Message ${i + 1}` }))
    return { messages }
  }
})

app.post("/api/messages", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const body = req.body as any
  const { channel, content } = body || {}
  if (!auth || !channel || !content) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const r = await pool.query(
      `WITH ch AS (
         SELECT id FROM channels WHERE name = $1::text LIMIT 1
       )
       INSERT INTO messages (channel_id, user_id, content)
       SELECT ch.id, $2::uuid, $3::text FROM ch
       RETURNING id::text AS id, content AS text, created_at AS ts`,
      [channel, payload.sub, content]
    )
    const m = r.rows[0] as { id: string; text: string; ts: string }
    const ur = await pool.query(
      `SELECT COALESCE(display_name, username) AS name, avatar_url FROM users WHERE id=$1::uuid LIMIT 1`,
      [payload.sub]
    )
    const sender = (ur.rows[0]?.name as string) || "User"
    const avatar = ur.rows[0]?.avatar_url as string | null
    
    let roleColor: string | undefined
    try {
       const rc = await pool.query(
         `SELECT roles.color 
          FROM server_members 
          JOIN channels ON channels.server_id = server_members.server_id
          JOIN roles ON roles.id = server_members.role_id
          WHERE channels.name = $1::text AND server_members.user_id = $2::uuid`,
         [channel, payload.sub]
       )
       roleColor = rc.rows[0]?.color
    } catch {}

    try {
      await redis.publish("messages", JSON.stringify({ channel, data: { type: "message", channel, message: m, user: sender, userAvatar: avatar, userId: payload.sub, roleColor } }))
    } catch {}
    return { message: { ...m, roleColor } }
  } catch (e) {
    console.error("POST /api/messages error:", e)
    return { error: `Unauthorized: ${e}` }
  }
})

app.get("/api/socket-info", async (req: FastifyRequest<{ Querystring: { channel?: string } }>) => {
  const channel = req.query.channel || ""
  const base = process.env.REALTIME_BASE_HTTP || "http://localhost:4001"
  try {
    const res = await fetch(`${base}/socket-info?channel=${encodeURIComponent(channel)}`)
    const data = await res.json() as any
    const wsUrl = process.env.REALTIME_BASE_WS || "ws://localhost/ws"
    return { exists: !!data.exists, wsUrl }
  } catch {
    const wsUrl = process.env.REALTIME_BASE_WS || "ws://localhost/ws"
    return { exists: false, wsUrl }
  }
})

const port = Number(process.env.PORT || 4000)
start()
  .then(() => app.listen({ port, host: "0.0.0.0" }))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
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

async function checkPermission(userId: string, serverId: string, perm: string) {
  if (!userId || !serverId) return false
  const server = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
  if (server.rows[0]?.owner_id === userId) return true

  const r = await pool.query(
    `SELECT roles.can_manage_channels, roles.can_manage_server, roles.can_manage_roles
     FROM server_members 
     JOIN roles ON roles.id = server_members.role_id 
     WHERE server_members.user_id=$1::uuid AND server_members.server_id=$2::uuid`,
    [userId, serverId]
  )
  const p = r.rows[0]
  if (!p) return false
  if (perm === 'can_manage_channels') return !!p.can_manage_channels
  if (perm === 'can_manage_server') return !!p.can_manage_server
  if (perm === 'can_manage_roles') return !!p.can_manage_roles
  return false
}

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

app.patch("/api/servers/:id/members/:userId", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const id = (req.params as any).id as string
  const userId = (req.params as any).userId as string
  const body = req.body as any
  const { roleId } = body || {}
  if (!auth || !id || !userId) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const allowed = await checkPermission(payload.sub, id, 'can_manage_roles')
    if (!allowed) return { error: "Missing permissions" }
    
    // Update role
    await pool.query(
      `UPDATE server_members SET role_id=$3::uuid WHERE server_id=$1::uuid AND user_id=$2::uuid`,
      [id, userId, roleId || null]
    )
    return { ok: true }
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
    const r = await pool.query(
      `SELECT server_members.role_id as "roleId", roles.name as "roleName", roles.color as "roleColor", roles.can_manage_roles as "canManageRoles"
       FROM server_members 
       LEFT JOIN roles ON roles.id = server_members.role_id 
       WHERE server_members.server_id=$1::uuid AND server_members.user_id=$2::uuid`,
      [id, userId]
    )
    return { member: r.rows[0] }
  } catch {
    return { error: "Unauthorized" }
  }
})

app.delete("/api/servers/:id/roles/:roleId", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const id = (req.params as any).id as string
  const roleId = (req.params as any).roleId as string
  if (!auth || !id || !roleId) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const allowed = await checkPermission(payload.sub, id, 'can_manage_roles')
    if (!allowed) return { error: "Missing permissions" }
    
    // Prevent deleting 'Owner' role or 'Member' role if critical? 
    // For now just allow delete, but maybe warn or block specific names?
    // The prompt says "create 2 roles... Owner and Member". "Owner... is the only person...".
    // Let's block deleting "Owner" role just in case.
    const role = await pool.query(`SELECT name FROM roles WHERE id=$1::uuid`, [roleId])
    if (role.rows[0]?.name === 'Owner') return { error: "Cannot delete Owner role" }
    
    await pool.query(`DELETE FROM roles WHERE id=$1::uuid`, [roleId])
    return { ok: true }
  } catch {
    return { error: "Unauthorized" }
  }
})

app.post("/api/servers/:id/invites", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const id = (req.params as any).id as string
  const body = req.body as any
  const { expiresInSeconds, maxUses } = body || {}
  if (!auth || !id) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const code = Math.random().toString(36).slice(2, 10)
    const r = await pool.query(
      `INSERT INTO invites (server_id, code, created_by, expires_at, max_uses)
       VALUES ($1::uuid, $2::text, $3::uuid, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(secs => $4::int) END, $5::int)
       RETURNING code`,
      [id, code, payload.sub, expiresInSeconds || null, maxUses || null]
    )
    return { code: r.rows[0].code as string }
  } catch {
    return { error: "Unauthorized" }
  }
})

app.get("/api/invites/:code", async (req) => {
  const code = (req.params as any).code as string
  const r = await pool.query(
    `SELECT invites.code, servers.id::text AS server_id, servers.name, invites.expires_at, invites.max_uses, invites.uses
     FROM invites JOIN servers ON servers.id = invites.server_id
     WHERE invites.code=$1::text LIMIT 1`,
    [code]
  )
  const row = r.rows[0]
  if (!row) return { error: "Not found" }
  const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now()
  const full = row.max_uses && row.uses >= row.max_uses
  return { invite: { code: row.code, serverId: row.server_id, serverName: row.name, expired: !!expired, full: !!full } }
})

app.post("/api/invites/:code/accept", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const code = (req.params as any).code as string
  if (!auth || !code) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const r = await pool.query(`SELECT server_id, expires_at, max_uses, uses FROM invites WHERE code=$1::text LIMIT 1`, [code])
    if (!r.rowCount) return { error: "Invalid invite" }
    const inv = r.rows[0] as { server_id: string; expires_at: string | null; max_uses: number | null; uses: number }
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return { error: "Invite expired" }
    if (inv.max_uses && inv.uses >= inv.max_uses) return { error: "Invite limit reached" }
    
    // Find Member role
    const rr = await pool.query(`SELECT id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1`, [inv.server_id])
    const roleId = rr.rows[0]?.id
    
    await pool.query(`INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, [inv.server_id, payload.sub, roleId || null])
    await pool.query(`UPDATE invites SET uses = COALESCE(uses,0) + 1 WHERE code=$1::text`, [code])
    return { ok: true }
  } catch {
    return { error: "Unauthorized" }
  }
})
