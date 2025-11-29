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
    
    // Friend System & User Discriminator
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS discriminator VARCHAR(4);`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_dms_from_strangers BOOLEAN DEFAULT TRUE;`)
    
    // Multiple Roles System
    await pool.query(`
      CREATE TABLE IF NOT EXISTS server_member_roles (
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (server_id, user_id, role_id)
      );
    `)

    // Moderation
    await pool.query(`ALTER TABLE server_members ADD COLUMN IF NOT EXISTS muted BOOLEAN DEFAULT FALSE;`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS server_bans (
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (server_id, user_id)
      );
    `)
    
    // DM System
    try {
      await pool.query(`ALTER TABLE channels ALTER COLUMN server_id DROP NOT NULL;`)
      await pool.query(`ALTER TABLE channels ALTER COLUMN category DROP NOT NULL;`)
    } catch (e) { console.log("channel schema modify error (might be fine):", e) }
    await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'text';`) // 'text', 'voice', 'dm'
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (channel_id, user_id)
      );
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS channel_permissions (
        channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        can_view BOOLEAN DEFAULT TRUE,
        can_send_messages BOOLEAN DEFAULT TRUE,
        PRIMARY KEY (channel_id, role_id)
      );
    `)

    // Create friendships table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id_1 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_id_2 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL, -- 'pending', 'accepted', 'blocked'
        action_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT unique_friendship UNIQUE (user_id_1, user_id_2),
        CONSTRAINT check_user_order CHECK (user_id_1 < user_id_2)
      );
    `)

    // Backfill discriminators for users who don't have one
    const usersWithoutDiscrim = await pool.query(`SELECT id, username FROM users WHERE discriminator IS NULL`)
    for (const u of usersWithoutDiscrim.rows) {
       let discrim = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
       // Simple collision check loop (not robust for high concurrency but fine here)
       let attempts = 0
       while (attempts < 10) {
          const check = await pool.query(`SELECT 1 FROM users WHERE username=$1 AND discriminator=$2`, [u.username, discrim])
          if (check.rowCount === 0) break
          discrim = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
          attempts++
       }
       await pool.query(`UPDATE users SET discriminator=$1 WHERE id=$2::uuid`, [discrim, u.id])
    }
    
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

    // Migrate roles to server_member_roles
    const smrCount = await pool.query(`SELECT count(*) as c FROM server_member_roles`)
    if (parseInt(smrCount.rows[0].c) === 0) {
       console.log("Migrating roles to server_member_roles...")
       await pool.query(`
         INSERT INTO server_member_roles (server_id, user_id, role_id)
         SELECT server_id, user_id, role_id FROM server_members WHERE role_id IS NOT NULL
         ON CONFLICT DO NOTHING
       `)
    }
  } catch (e) {
    console.error("Migration failed", e)
  }
}

// Friend System Endpoints

// Get Friends (accepted)
app.get("/api/friends", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  if (!auth) return { error: "Unauthorized" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const r = await pool.query(
      `SELECT u.id::text, u.username, u.display_name, u.avatar_url, u.status, u.discriminator
       FROM friendships f
       JOIN users u ON (u.id = CASE WHEN f.user_id_1 = $1::uuid THEN f.user_id_2 ELSE f.user_id_1 END)
       WHERE (f.user_id_1 = $1::uuid OR f.user_id_2 = $1::uuid)
         AND f.status = 'accepted'
       ORDER BY f.updated_at DESC`,
      [payload.sub]
    )
    return { friends: r.rows.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      status: u.status,
      discriminator: u.discriminator
    }))}
  } catch (e) {
    return { error: "Unauthorized" }
  }
})

// Get Pending Requests
app.get("/api/friends/requests", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  if (!auth) return { error: "Unauthorized" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const r = await pool.query(
      `SELECT f.id::text as request_id, f.action_user_id::text as sender_id,
              u.id::text as user_id, u.username, u.display_name, u.avatar_url, u.discriminator,
              CASE WHEN f.action_user_id = $1::uuid THEN 'outgoing' ELSE 'incoming' END as type
       FROM friendships f
       JOIN users u ON (u.id = CASE WHEN f.user_id_1 = $1::uuid THEN f.user_id_2 ELSE f.user_id_1 END)
       WHERE (f.user_id_1 = $1::uuid OR f.user_id_2 = $1::uuid)
         AND f.status = 'pending'`,
      [payload.sub]
    )
    return { requests: r.rows.map(row => ({
      id: row.request_id,
      type: row.type,
      user: {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        discriminator: row.discriminator
      }
    }))}
  } catch (e) {
    return { error: "Unauthorized" }
  }
})

// Send Friend Request
app.post("/api/friends/request", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const body = req.body as any
  const { username, userId } = body || {} // Can accept username#discrim OR userId
  if (!auth || (!username && !userId)) return { error: "Bad request" }
  
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const senderId = payload.sub
    
    let targetUser;
    if (userId) {
       const r = await pool.query(`SELECT id, username FROM users WHERE id=$1::uuid`, [userId])
       targetUser = r.rows[0]
    } else if (username) {
       targetUser = await findUserByUsernameOrEmail(username)
    }
    
    if (!targetUser) return { error: "User not found" }
    if (targetUser.id === senderId) return { error: "Cannot add self" }

    // Order IDs
    const [id1, id2] = [senderId, targetUser.id].sort()
    
    // Check existing
    const existing = await pool.query(
      `SELECT status, action_user_id FROM friendships WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid`,
      [id1, id2]
    )
    
    if (existing.rowCount && existing.rowCount > 0) {
       const status = existing.rows[0].status
       if (status === 'accepted') return { error: "Already friends" }
       if (status === 'pending') {
          if (existing.rows[0].action_user_id === senderId) return { error: "Request already sent" }
          else {
             // Accept their request if they sent one
             await pool.query(
               `UPDATE friendships SET status='accepted', action_user_id=$3::uuid WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid`,
               [id1, id2, senderId]
             )
             return { status: 'accepted' }
          }
       }
       if (status === 'blocked') return { error: "Cannot add friend" } 
    }
    
    await pool.query(
      `INSERT INTO friendships (user_id_1, user_id_2, status, action_user_id) VALUES ($1::uuid, $2::uuid, 'pending', $3::uuid)`,
      [id1, id2, senderId]
    )
    
    return { status: 'pending' }
  } catch (e) {
    console.error(e)
    return { error: "Server error" }
  }
})

// Accept/Decline Request
app.post("/api/friends/requests/:id/:action", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const id = (req.params as any).id as string 
  const action = (req.params as any).action as string 
  
  if (!auth || !id || !['accept', 'decline'].includes(action)) return { error: "Bad request" }
  
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    
    const f = await pool.query(`SELECT * FROM friendships WHERE id=$1::uuid`, [id])
    if (!f.rowCount) return { error: "Request not found" }
    const friendship = f.rows[0]
    
    if (friendship.status !== 'pending') return { error: "Request not pending" }
    
    // Verify user is part of this and NOT the action_user_id (sender)
    if (friendship.action_user_id === payload.sub && action === 'accept') return { error: "Cannot accept own request" }
    if (friendship.user_id_1 !== payload.sub && friendship.user_id_2 !== payload.sub) return { error: "Unauthorized" }
    
    if (action === 'accept') {
       await pool.query(`UPDATE friendships SET status='accepted', action_user_id=$2::uuid, updated_at=now() WHERE id=$1::uuid`, [id, payload.sub])
    } else {
       await pool.query(`DELETE FROM friendships WHERE id=$1::uuid`, [id])
    }
    
    return { ok: true }
  } catch {
    return { error: "Unauthorized" }
  }
})

// Remove Friend
app.delete("/api/friends/:friendId", async (req) => {
   const auth = (req.headers as any).authorization as string | undefined
   const friendId = (req.params as any).friendId as string
   if (!auth || !friendId) return { error: "Bad request" }
   
   try {
     const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
     const [id1, id2] = [payload.sub, friendId].sort()
     
     await pool.query(`DELETE FROM friendships WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid`, [id1, id2])
     return { ok: true }
   } catch {
     return { error: "Unauthorized" }
   }
})

// DM Endpoints

// Get DMs
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

// Create/Get DM
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

// Member Management Endpoints

// Update Member Roles
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

// Kick Member
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

// Ban Member
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
      
      let discrim = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
      let attempts = 0
      while (attempts < 10) {
         const check = await pool.query(`SELECT 1 FROM users WHERE username=$1 AND discriminator=$2`, [username, discrim])
         if (check.rowCount === 0) break
         discrim = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
         attempts++
      }

      const r = await pool.query(
        `INSERT INTO users (username, email, password_hash, display_name, avatar_url, discriminator)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id::text AS id, username, email, display_name, discriminator`,
        [username, email, passwordHash, displayName, user.profilePictureUrl || null, discrim]
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
  
  let discrim = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  let attempts = 0
  while (attempts < 10) {
     const check = await pool.query(`SELECT 1 FROM users WHERE username=$1 AND discriminator=$2`, [username, discrim])
     if (check.rowCount === 0) break
     discrim = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
     attempts++
  }

  const exists = await pool.query("SELECT 1 FROM users WHERE (username=$1 AND discriminator=$2) OR email=$3 LIMIT 1", [username, discrim, email])
  if (exists.rowCount) return { error: "Username+Tag or email already in use" }
  const hash = await bcrypt.hash(String(password), 10)
  const r = await pool.query(
    `INSERT INTO users (username, email, password_hash, display_name, discriminator)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id::text AS id, username, email, display_name, discriminator`,
    [username, email, hash, displayName || username, discrim]
  )
  const user = r.rows[0] as { id: string; username: string; email: string; display_name: string; discriminator: string }
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

app.delete("/api/debug/seed-data", async () => {
   try {
     await pool.query("DELETE FROM friendships")
     await pool.query("DELETE FROM channels WHERE type='dm'")
     return { ok: true }
   } catch (e) {
     return { error: String(e) }
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

app.get("/api/servers/:id/members", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const id = (req.params as any).id as string
  if (!auth || !id) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    
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
    
    const members = r.rows.map(row => ({
        ...row,
        roles: row.roles.filter((r: any) => r !== null)
    }))
    
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

    // If no user, return public only? Or just empty? 
    // Assuming authorized context for now.
    
    let query = `SELECT c.id, c.name, c.category, c.type, FALSE as "canSendMessages" FROM channels c WHERE ($1::uuid IS NULL OR c.server_id=$1::uuid) `
    const params: any[] = [serverId]
    
    // Map of channelId -> canSend
    const canSendMap = new Map<string, boolean>()

    if (userId) {
       // Check if owner
       const s = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
       const isOwner = s.rows[0]?.owner_id === userId
       
       if (!isOwner) {
          // Filter by permissions
          // Logic: 
          // 1. If channel has NO permissions rows, it is public (visible to all members)
          // 2. If channel has permissions rows, user must have a role with can_view=true
          query += `
            AND (
              c.type = 'dm' OR
              NOT EXISTS (SELECT 1 FROM channel_permissions cp WHERE cp.channel_id = c.id)
              OR EXISTS (
                 SELECT 1 FROM channel_permissions cp
                 JOIN server_member_roles smr ON smr.role_id = cp.role_id
                 WHERE cp.channel_id = c.id 
                   AND smr.user_id = $2::uuid
                   AND smr.server_id = c.server_id
                   AND cp.can_view = TRUE
              )
            )
          `
          params.push(userId)
       }
       
       // Calculate canSendMessages for each channel
       // If owner, true.
       // If not owner:
       //   If type=dm, true (if member).
       //   If type!=dm:
       //      If NO permission rows, True (public).
       //      If permission rows, must have can_send_messages=true in one of the roles.
       // We can fetch all permissions for this user in this server to map it.
       const perms = await pool.query(
         `SELECT cp.channel_id, cp.can_send_messages
          FROM channel_permissions cp
          JOIN server_member_roles smr ON smr.role_id = cp.role_id
          WHERE smr.user_id = $1::uuid AND smr.server_id = $2::uuid`,
         [userId, serverId]
       )
       
       const allChannelIdsWithPerms = await pool.query(
         `SELECT DISTINCT channel_id FROM channel_permissions 
          JOIN channels ON channels.id = channel_permissions.channel_id
          WHERE channels.server_id = $1::uuid`,
         [serverId]
       )
       const restrictedChannels = new Set(allChannelIdsWithPerms.rows.map(r => r.channel_id))
       
       // Build map of allowed by perms
       const allowedByPerms = new Set<string>()
       for (const p of perms.rows) {
         if (p.can_send_messages) allowedByPerms.add(p.channel_id)
       }
       
       // We'll post-process the list
    }

    query += ` ORDER BY c.category, c.name`
    
    const ch = await pool.query(query, params)
    
    // Post-process canSendMessages
    if (userId) {
        const s = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [serverId])
        const isOwner = s.rows[0]?.owner_id === userId
        
        // Get all restricted channels again to be safe (or reuse if we scope it out)
        const allChannelIdsWithPerms = await pool.query(
             `SELECT DISTINCT channel_id FROM channel_permissions 
              JOIN channels ON channels.id = channel_permissions.channel_id
              WHERE channels.server_id = $1::uuid`,
             [serverId]
        )
        const restrictedChannels = new Set(allChannelIdsWithPerms.rows.map(r => r.channel_id))
        
        const userPerms = await pool.query(
             `SELECT cp.channel_id, cp.can_send_messages
              FROM channel_permissions cp
              JOIN server_member_roles smr ON smr.role_id = cp.role_id
              WHERE smr.user_id = $1::uuid AND smr.server_id = $2::uuid`,
             [userId, serverId]
        )
        const allowedByPerms = new Set<string>()
        for (const p of userPerms.rows) {
             if (p.can_send_messages) allowedByPerms.add(p.channel_id)
        }

        for (const row of ch.rows) {
            if (row.type === 'dm') {
               row.canSendMessages = true
            } else if (isOwner) {
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
    } else {
        // No user? default false
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

app.get("/api/users", async (req: FastifyRequest<{ Querystring: { serverId?: string } }>) => {
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

app.get("/api/messages", async (req: FastifyRequest<{ Querystring: { channel?: string; limit?: string; before?: string; serverId?: string } }>) => {
  const auth = (req.headers as any).authorization as string | undefined
  if (!auth) return { error: "Unauthorized" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const channel = req.query.channel
    const serverId = req.query.serverId
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50"), 1), 200)
    const before = req.query.before || null
    
    // Check if channel param is UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channel || "")
    
    let channelId = channel
    if (!isUUID && channel) {
       // Lookup by name (legacy support for server channels by name)
       if (serverId) {
          const c = await pool.query(`SELECT id FROM channels WHERE name=$1::text AND server_id=$2::uuid LIMIT 1`, [channel, serverId])
          channelId = c.rows[0]?.id
       } else {
          const c = await pool.query(`SELECT id FROM channels WHERE name=$1::text LIMIT 1`, [channel])
          channelId = c.rows[0]?.id
       }
    }
    
    if (!channelId) return { messages: [] }
    
    // Verify access
    const c = await pool.query(`SELECT server_id, type FROM channels WHERE id=$1::uuid`, [channelId])
    if (!c.rowCount) return { messages: [] }
    
    if (c.rows[0].type === 'dm') {
        const m = await pool.query(`SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, [channelId, payload.sub])
        if (!m.rowCount) return { error: "Unauthorized" }
    } else {
        // Check view permissions
        const hasPerms = await pool.query(`SELECT 1 FROM channel_permissions WHERE channel_id=$1::uuid LIMIT 1`, [channelId])
        if (hasPerms.rowCount && hasPerms.rowCount > 0) {
           const perms = await pool.query(
             `SELECT cp.can_view
              FROM channel_permissions cp
              JOIN server_member_roles smr ON smr.role_id = cp.role_id
              WHERE cp.channel_id = $1::uuid 
                AND smr.user_id = $2::uuid
                AND smr.server_id = $3::uuid`,
             [channelId, payload.sub, c.rows[0].server_id]
           )
           const canView = perms.rows.some(r => r.can_view)
           const serv = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [c.rows[0].server_id])
           const isOwner = serv.rows[0]?.owner_id === payload.sub
           
           if (!canView && !isOwner) return { error: "Unauthorized" }
        }
    }

    const r = await pool.query(
      `SELECT messages.id::text AS id, 
              COALESCE(users.display_name, users.username) AS user, 
              users.avatar_url AS user_avatar,
              users.id::text AS user_id,
              messages.content AS text, 
              messages.created_at AS ts,
              (
                SELECT r.color 
                FROM server_member_roles smr
                JOIN roles r ON r.id = smr.role_id
                WHERE smr.user_id = messages.user_id AND smr.server_id = channels.server_id
                ORDER BY r.position ASC
                LIMIT 1
              ) AS role_color
       FROM messages
       JOIN channels ON channels.id = messages.channel_id
       LEFT JOIN users ON users.id = messages.user_id
       WHERE messages.channel_id = $1::uuid
         AND ($2::timestamptz IS NULL OR messages.created_at < $2::timestamptz)
       ORDER BY messages.created_at DESC
       LIMIT $3`,
      [channelId, before, limit]
    )
    const rows = r.rows as { id: string; user: string | null; user_avatar: string | null; user_id: string | null; text: string; ts: string; role_color: string | null }[]
    return { messages: rows.reverse().map(m => ({ id: m.id, user: m.user ?? "User", userAvatar: m.user_avatar, userId: m.user_id, text: m.text, ts: m.ts, roleColor: m.role_color || undefined })) }
  } catch (e) {
    console.error("GET /api/messages error:", e)
    return { messages: [] }
  }
})

app.post("/api/messages", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const body = req.body as any
  const { channel, content, serverId } = body || {}
  if (!auth || !channel || !content) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    
    let channelId = channel
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channel)
    
    if (!isUUID) {
       if (serverId) {
          const c = await pool.query(`SELECT id FROM channels WHERE name=$1::text AND server_id=$2::uuid LIMIT 1`, [channel, serverId])
          if (!c.rowCount) return { error: "Channel not found" }
          channelId = c.rows[0].id
       } else {
          const c = await pool.query(`SELECT id FROM channels WHERE name=$1::text LIMIT 1`, [channel])
          if (!c.rowCount) return { error: "Channel not found" }
          channelId = c.rows[0].id
       }
    }
    
    const c = await pool.query(`SELECT server_id, type FROM channels WHERE id=$1::uuid`, [channelId])
    if (!c.rowCount) return { error: "Channel not found" }
    
    if (c.rows[0].type === 'dm') {
       const m = await pool.query(`SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, [channelId, payload.sub])
       if (!m.rowCount) return { error: "Not a member of this DM" }
    } else {
       const s = await pool.query(`SELECT muted FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid`, [c.rows[0].server_id, payload.sub])
       if (!s.rowCount) return { error: "Not a member of this server" }
       if (s.rows[0].muted) return { error: "You are muted" }
       
       // Check channel permissions
       const perms = await pool.query(
         `SELECT cp.can_send_messages 
          FROM channel_permissions cp
          JOIN server_member_roles smr ON smr.role_id = cp.role_id
          WHERE cp.channel_id = $1::uuid 
            AND smr.user_id = $2::uuid
            AND smr.server_id = $3::uuid`,
         [channelId, payload.sub, c.rows[0].server_id]
       )
       
       // If permissions exist, user must have explicit allow
       const hasPerms = await pool.query(`SELECT 1 FROM channel_permissions WHERE channel_id=$1::uuid LIMIT 1`, [channelId])
       if (hasPerms.rowCount && hasPerms.rowCount > 0) {
          const canSend = perms.rows.some(r => r.can_send_messages)
          
          // Check if owner
          const serv = await pool.query(`SELECT owner_id FROM servers WHERE id=$1::uuid`, [c.rows[0].server_id])
          const isOwner = serv.rows[0]?.owner_id === payload.sub
          
          if (!canSend && !isOwner) return { error: "Missing permissions" }
       }
    }

    const r = await pool.query(
      `INSERT INTO messages (channel_id, user_id, content)
       VALUES ($1::uuid, $2::uuid, $3::text)
       RETURNING id::text AS id, content AS text, created_at AS ts`,
      [channelId, payload.sub, content]
    )
    const m = r.rows[0] as { id: string; text: string; ts: string }
    
    const ur = await pool.query(
      `SELECT COALESCE(display_name, username) AS name, avatar_url FROM users WHERE id=$1::uuid LIMIT 1`,
      [payload.sub]
    )
    const sender = (ur.rows[0]?.name as string) || "User"
    const avatar = ur.rows[0]?.avatar_url as string | null
    
    let roleColor: string | undefined
    if (c.rows[0].type !== 'dm') {
        try {
           const rc = await pool.query(
             `SELECT roles.color 
              FROM server_member_roles 
              JOIN roles ON roles.id = server_member_roles.role_id
              WHERE server_member_roles.server_id = $1::uuid AND server_member_roles.user_id = $2::uuid
              ORDER BY roles.position ASC LIMIT 1`,
             [c.rows[0].server_id, payload.sub]
           )
           roleColor = rc.rows[0]?.color
        } catch {}
    }

    try {
      await redis.publish("messages", JSON.stringify({ channel: channelId, data: { type: "message", channel: channelId, message: m, user: sender, userAvatar: avatar, userId: payload.sub, roleColor } }))
      if (channel !== channelId) {
         await redis.publish("messages", JSON.stringify({ channel, data: { type: "message", channel, message: m, user: sender, userAvatar: avatar, userId: payload.sub, roleColor } }))
      }
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
    
    const r = await pool.query(
      `SELECT 
         json_agg(json_build_object(
           'id', roles.id,
           'name', roles.name,
           'color', roles.color,
           'position', roles.position
         ) ORDER BY roles.position ASC) as roles
       FROM server_member_roles
       JOIN roles ON roles.id = server_member_roles.role_id
       WHERE server_member_roles.server_id=$1::uuid AND server_member_roles.user_id=$2::uuid`,
      [id, userId]
    )
    
    const roles = r.rows[0]?.roles || []
    return { member: { roles } }
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
    if (roleId) {
       await pool.query(`INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, [inv.server_id, payload.sub, roleId])
    }
    
    await pool.query(`UPDATE invites SET uses = COALESCE(uses,0) + 1 WHERE code=$1::text`, [code])
    return { ok: true }
  } catch {
    return { error: "Unauthorized" }
  }
})
