import { Pool } from "pg"

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err)
})

pool.on('connect', (client) => {
  console.log('New client connected to database pool')
})

// Test the connection immediately and run migrations
pool.query('SELECT NOW()').then(async (res) => {
  console.log('Database connection test successful:', res.rows[0])
  
  // Simple migration to add attachment_url if not exists
  try {
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;`)
    console.log("Migration: Added attachment_url to messages table")
    
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_background_url TEXT;`)
    console.log("Migration: Added custom_background_url to users table")

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_background_opacity NUMERIC DEFAULT 0.85;`)
    console.log("Migration: Added custom_background_opacity to users table")
  } catch (e) {
    console.error("Migration failed:", e)
  }
}).catch((err) => {
  console.error('Database connection test failed:', err)
})
