
import { Pool } from "pg"
import jwt from "jsonwebtoken"

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://app:app@localhost:5432/app"
})

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_key"

async function run() {
  try {
    console.log("Testing DM Flow...")
    
    // 1. Create 2 Users
    const u1Name = "test_user_1_" + Date.now()
    const u2Name = "test_user_2_" + Date.now()
    
    const u1 = await pool.query(`INSERT INTO users (username, email, password_hash, discriminator) VALUES ($1, $1, 'hash', '0001') RETURNING id`, [u1Name])
    const u2 = await pool.query(`INSERT INTO users (username, email, password_hash, discriminator) VALUES ($1, $1, 'hash', '0002') RETURNING id`, [u2Name])
    
    const id1 = u1.rows[0].id
    const id2 = u2.rows[0].id
    
    console.log(`Created users: ${id1}, ${id2}`)
    
    // 2. Create Friendship
    await pool.query(`INSERT INTO friendships (user_id_1, user_id_2, status, action_user_id) VALUES ($1, $2, 'accepted', $1)`, [id1 < id2 ? id1 : id2, id1 < id2 ? id2 : id1])
    console.log("Friendship created.")
    
    // 3. Create DM (Simulate API)
    // Mock payload for User 1
    // Logic from server.ts:
    /*
    const check = await pool.query(...)
    if (check) return id
    ...
    insert into channels...
    insert into channel_members...
    */
    
    console.log("Creating DM...")
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        
        // Check existing
        const check = await client.query(
          `SELECT c.id 
           FROM channels c
           JOIN channel_members cm1 ON c.id = cm1.channel_id
           JOIN channel_members cm2 ON c.id = cm2.channel_id
           WHERE c.type = 'dm' AND cm1.user_id = $1::uuid AND cm2.user_id = $2::uuid
           LIMIT 1`,
          [id1, id2]
        )
        
        if (check.rowCount > 0) {
            console.log("DM already exists (unexpected):", check.rows[0].id)
        } else {
            const c = await client.query(`INSERT INTO channels (type, name) VALUES ('dm', 'dm') RETURNING id`, [])
            const cid = c.rows[0].id
            await client.query(`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)`, [cid, id1, id2])
            console.log("DM created with ID:", cid)
            
            // Verify
            const verify = await client.query(`SELECT * FROM channel_members WHERE channel_id=$1`, [cid])
            if (verify.rowCount === 2) {
                console.log("Verification Successful: 2 members in channel.")
            } else {
                console.error("Verification Failed:", verify.rowCount)
            }
        }
        
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
    
    // Clean up
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [id1, id2])
    console.log("Cleanup done.")
    
  } catch (e) {
    console.error(e)
  } finally {
    await pool.end()
  }
}

run()
