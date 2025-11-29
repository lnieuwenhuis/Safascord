
import { Pool } from "pg"

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://app:app@localhost:5432/app"
})

async function run() {
  try {
    console.log("Clearing Friendships and DMs...")
    
    // Clear Friendships
    await pool.query("DELETE FROM friendships")
    console.log("Friendships cleared.")
    
    // Clear DM Channels
    // DM channels have type='dm'
    await pool.query("DELETE FROM channels WHERE type='dm'")
    console.log("DM Channels cleared.")
    
    // Clear Channel Members for DMs (Cascaded? Check schema)
    // The schema says ON DELETE CASCADE for channel_members referencing channels(id)
    // So deleting channels should be enough.
    
    console.log("Done.")
  } catch (e) {
    console.error(e)
  } finally {
    await pool.end()
  }
}

run()
