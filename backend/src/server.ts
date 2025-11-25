import Fastify, { FastifyRequest } from "fastify"
import cors from "@fastify/cors"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

const app = Fastify({ logger: true })

async function start() {
  await app.register(cors, {
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  })
}

app.get("/api/health", async () => ({ ok: true }))

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
      if (sid) await pool.query(`INSERT INTO server_members (server_id, user_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT DO NOTHING`, [sid, user.id])
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
      `SELECT id::text AS id, username, email, display_name
       FROM users WHERE id = $1::uuid`,
      [payload.sub]
    )
    const u = r.rows[0]
    if (!u) return { error: "Unauthorized" }
    return { user: { id: u.id, username: u.username, email: u.email, displayName: u.display_name } }
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
      `SELECT servers.id::text AS id, servers.name
       FROM server_members
       JOIN servers ON servers.id = server_members.server_id
       WHERE server_members.user_id = $1::uuid
       ORDER BY servers.name`,
      [payload.sub]
    )
    const servers = r.rows as { id: string; name: string }[]
    return { servers }
  } catch {
    return { servers: [] }
  }
})

app.post("/api/servers", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const body = req.body as any
  const { name } = body || {}
  if (!auth || !name) return { error: "Bad request" }
  try {
    const payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET) as any
    const r = await pool.query(
      `INSERT INTO servers (name, owner_id) VALUES ($1::text, $2::uuid)
       RETURNING id::text AS id, name`,
      [name, payload.sub]
    )
    const s = r.rows[0] as { id: string; name: string }
    await pool.query(`INSERT INTO server_members (server_id, user_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT DO NOTHING`, [s.id, payload.sub])
    return { server: s }
  } catch {
    return { error: "Unauthorized" }
  }
})

app.patch("/api/servers/:id", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const body = req.body as any
  const id = (req.params as any).id as string
  const { name } = body || {}
  if (!auth || !id || !name) return { error: "Bad request" }
  try {
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
    const r = await pool.query(`UPDATE servers SET name=$2 WHERE id=$1::uuid RETURNING id::text AS id, name`, [id, name])
    return { server: r.rows[0] as { id: string; name: string } }
  } catch {
    return { error: "Unauthorized" }
  }
})

app.delete("/api/servers/:id", async (req) => {
  const auth = (req.headers as any).authorization as string | undefined
  const id = (req.params as any).id as string
  if (!auth || !id) return { error: "Bad request" }
  try {
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
    await pool.query(`DELETE FROM servers WHERE id=$1::uuid`, [id])
    return { ok: true }
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
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
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
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
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
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
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
      `SELECT roles.display_group AS title, ARRAY_AGG(users.username ORDER BY users.username) AS users
       FROM server_members
       JOIN roles ON roles.id = server_members.role_id
       JOIN users ON users.id = server_members.user_id
       WHERE ($1::uuid IS NULL OR server_members.server_id = $1::uuid)
       GROUP BY roles.display_group
       ORDER BY roles.display_group`,
      [serverId || null]
    )
    const groups = r.rows as { title: string; users: string[] }[]
    return { groups }
  } catch {
    const groups = [
      { title: "Admin", users: ["Dylan", "Koda"] },
      { title: "Staff", users: ["Jayden", "Squires"] },
      { title: "FST", users: ["Alex", "Flubber", "Fraser", "Jack", "Sam"] },
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
      `SELECT messages.id::text AS id, COALESCE(users.display_name, users.username) AS user, messages.content AS text, messages.created_at AS ts
       FROM messages
       JOIN channels ON channels.id = messages.channel_id
       LEFT JOIN users ON users.id = messages.user_id
       WHERE ($1::text IS NULL OR channels.name = $1::text)
         AND ($2::timestamptz IS NULL OR messages.created_at < $2::timestamptz)
       ORDER BY messages.created_at DESC
       LIMIT $3`,
      [channelName || null, before, limit]
    )
    const rows = r.rows as { id: string; user: string | null; text: string; ts: string }[]
    return { messages: rows.reverse().map(m => ({ id: m.id, user: m.user ?? "User", text: m.text, ts: m.ts })) }
  } catch {
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
      `SELECT COALESCE(display_name, username) AS name FROM users WHERE id=$1::uuid LIMIT 1`,
      [payload.sub]
    )
    const sender = (ur.rows[0]?.name as string) || "User"
    try {
      const base = process.env.REALTIME_BASE_HTTP || "http://localhost:4001"
      await fetch(`${base}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, data: { type: "message", channel, message: m, user: sender, userId: payload.sub } }),
      })
    } catch {}
    return { message: m }
  } catch {
    return { error: "Unauthorized" }
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
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
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
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
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
    jwt.verify(auth.replace(/^Bearer\s+/i, ""), JWT_SECRET)
    await pool.query(`DELETE FROM channel_categories WHERE id=$1::uuid`, [id])
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
    await pool.query(`INSERT INTO server_members (server_id, user_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT DO NOTHING`, [inv.server_id, payload.sub])
    await pool.query(`UPDATE invites SET uses = COALESCE(uses,0) + 1 WHERE code=$1::text`, [code])
    return { ok: true }
  } catch {
    return { error: "Unauthorized" }
  }
})
