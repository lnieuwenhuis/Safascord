import { pool } from "./db.js"

async function ensureBaseSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      display_name TEXT,
      password_hash TEXT,
      avatar_url TEXT,
      bio TEXT,
      banner_color TEXT DEFAULT '#000000',
      banner_url TEXT,
      custom_background_url TEXT,
      custom_background_opacity REAL DEFAULT 0.85,
      status TEXT DEFAULT 'online',
      discriminator VARCHAR(4),
      allow_dms_from_strangers BOOLEAN DEFAULT TRUE,
      notifications_quiet_mode BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now(),
      shoo_sub TEXT
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS servers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      banner_url TEXT,
      owner_id UUID REFERENCES users(id) ON DELETE SET NULL
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      display_group TEXT NOT NULL DEFAULT 'Member',
      color TEXT DEFAULT '#99aab5',
      can_manage_channels BOOLEAN DEFAULT FALSE,
      can_manage_server BOOLEAN DEFAULT FALSE,
      can_manage_roles BOOLEAN DEFAULT FALSE,
      position INTEGER DEFAULT 0
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS server_members (
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
      muted BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (server_id, user_id)
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type VARCHAR(20) NOT NULL DEFAULT 'text',
      category TEXT
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (channel_id, user_id)
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      attachment_url TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,
      max_uses INT,
      uses INT NOT NULL DEFAULT 0
    );
  `)
}

export async function runMigrations() {
  try {
    await ensureBaseSchema()

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_color TEXT DEFAULT '#000000';`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_background_url TEXT;`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_background_opacity REAL DEFAULT 0.85;`)
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
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS shoo_sub TEXT;`)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_shoo_sub_unique ON users(shoo_sub) WHERE shoo_sub IS NOT NULL;`)
    
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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_server_members_user_server ON server_members(user_id, server_id);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_server_member_roles_user_server ON server_member_roles(user_id, server_id);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_server_member_roles_server_user ON server_member_roles(server_id, user_id);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channel_members_user_channel ON channel_members(user_id, channel_id);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channels_type_id ON channels(type, id);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channels_server_name ON channels(server_id, name);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channels_server_category_name ON channels(server_id, category, name);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_channel_created_at ON messages(channel_id, created_at DESC);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_role ON channel_permissions(channel_id, role_id);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_send ON channel_permissions(channel_id, can_send_messages);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_view ON channel_permissions(channel_id, can_view);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_roles_server_position ON roles(server_id, position);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_friendships_user1_status_updated ON friendships(user_id_1, status, updated_at DESC);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_friendships_user2_status_updated ON friendships(user_id_2, status, updated_at DESC);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_friendships_action_status ON friendships(action_user_id, status);`)

    // Notifications
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_quiet_mode BOOLEAN DEFAULT FALSE;`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        source_id UUID,
        source_type VARCHAR(50),
        channel_id UUID,
        content TEXT,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `)
    
    // Add channel_id if missing (for existing table)
    try {
      await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel_id UUID;`)
    } catch {}
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications(user_id, created_at DESC);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_channel_read ON notifications(user_id, channel_id, read);`)

    // Message Attachments (ensure schema consistency)
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;`)
    
    console.log("Migrations complete")
  } catch (e) {
    console.error("Migration error:", e)
    process.exit(1)
  }
}
