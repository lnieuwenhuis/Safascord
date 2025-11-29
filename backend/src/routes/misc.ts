import { FastifyInstance } from "fastify"
import { pool } from "../lib/db.js"

export async function miscRoutes(app: FastifyInstance) {
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

  app.delete("/api/debug/seed-data", async () => {
     try {
       await pool.query("DELETE FROM friendships")
       await pool.query("DELETE FROM channels WHERE type='dm'")
       return { ok: true }
     } catch (e) {
       return { error: String(e) }
     }
  })
}
