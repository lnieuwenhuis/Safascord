import { FastifyInstance } from "fastify"
import jwt from "jsonwebtoken"
import { pool } from "../lib/db.js"
import { JWT_SECRET, findUserByUsernameOrEmail } from "../lib/auth.js"

export async function friendRoutes(app: FastifyInstance) {
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
}
