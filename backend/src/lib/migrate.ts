import { pool } from "./db.js"

export async function runMigrations() {
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

    // Migrate roles to server_member_roles (Sync ensure)
    await pool.query(`
      INSERT INTO server_member_roles (server_id, user_id, role_id)
      SELECT server_id, user_id, role_id FROM server_members WHERE role_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `)

    // System Metrics for Historical Graphs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cpu_load REAL,
        memory_used REAL, -- in MB
        disk_used REAL,   -- in GB (simplified)
        avg_latency REAL, -- in ms
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `)
    // Index for faster time-range queries
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_metrics_created_at ON system_metrics(created_at);`)
    
    // Fix missing created_at on messages/users if it happens
    try {
       await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();`)
       await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();`)
    } catch {}

    // Performance Indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_server_member_roles_user_server ON server_member_roles(user_id, server_id);`)
    
  } catch (e) {
    console.error("Migration failed", e)
  }
}
