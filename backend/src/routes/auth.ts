import { FastifyInstance } from "fastify"
import { WorkOS } from '@workos-inc/node'
import bcrypt from "bcryptjs"
import { pool } from "../lib/db.js"
import { signToken, findUserByUsernameOrEmail } from "../lib/auth.js"

const workos = new WorkOS(process.env.WORKOS_API_KEY || "placeholder")
const clientId = process.env.WORKOS_CLIENT_ID || ""

export async function authRoutes(app: FastifyInstance) {
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
             if (rid) {
               await pool.query(`INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, [sid, u.id, rid])
             }
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
        if (rid) {
           await pool.query(`INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, [sid, user.id, rid])
        }
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
           if (rid) {
              await pool.query(`INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING`, [sid, user.id, rid])
           }
        }
      }
    } catch {}
    return { token, user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name } }
  })
}
