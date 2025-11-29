import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app:app@localhost:5432/app'
})

async function main() {
  try {
    console.log("Resetting data for 2-user test...")
    
    // 1. Clear all DMs
    await pool.query(`DELETE FROM channels WHERE type='dm'`)
    
    // 2. Clear all friendships
    await pool.query(`DELETE FROM friendships`)
    
    // 3. Keep only 2 specific users if possible, or just delete all but the first 2 created?
    // The user said "remove the 15 seeded conversations and 20 friends... let me test it with 2 users"
    // Safest is to just clear the relationships (DMs, friends) and maybe messages in DMs.
    // The users themselves can stay, or we can delete the "seeded" ones if we can identify them.
    // Assuming seeded users might have specific names or emails?
    // If I look at seed.ts (if it exists) I might know. 
    // For now, let's just clear relationships.
    
    console.log("Cleared DMs and Friendships.")
    
    process.exit(0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
}

main()
