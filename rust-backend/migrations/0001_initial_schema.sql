CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  banner_url TEXT,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL
);

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

CREATE TABLE IF NOT EXISTS server_members (
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  muted BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'text',
  category TEXT
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS server_member_roles (
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (server_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS server_bans (
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS channel_permissions (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT TRUE,
  can_send_messages BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (channel_id, role_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_1 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  action_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_friendship UNIQUE (user_id_1, user_id_2),
  CONSTRAINT check_user_order CHECK (user_id_1 < user_id_2)
);

CREATE TABLE IF NOT EXISTS system_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cpu_load REAL,
  memory_used REAL,
  disk_used REAL,
  avg_latency REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

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

