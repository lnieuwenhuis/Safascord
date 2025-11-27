CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  password_hash TEXT
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_color TEXT DEFAULT '#000000';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
UPDATE users SET display_name = username WHERE display_name IS NULL;

CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_group TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users (username, email) VALUES
  ('Dylan','dylan@example.com'),
  ('Koda','koda@example.com'),
  ('Jayden','jayden@example.com'),
  ('Squires','squires@example.com'),
  ('Alex','alex@example.com'),
  ('Flubber','flubber@example.com'),
  ('Fraser','fraser@example.com'),
  ('Jack','jack@example.com'),
  ('Sam','sam@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO servers (name, owner_id)
SELECT 'FST [est. 2025]', (SELECT id FROM users WHERE username='Dylan')
ON CONFLICT DO NOTHING;

INSERT INTO roles (server_id, name, display_group)
SELECT s.id, r.name, r.display_group
FROM (VALUES
  ('Admin','Admin'),
  ('Staff','Staff'),
  ('Member','FST')
) AS r(name, display_group), (SELECT id FROM servers WHERE name='FST [est. 2025]') s
ON CONFLICT DO NOTHING;

WITH s AS (SELECT id FROM servers WHERE name='FST [est. 2025]')
INSERT INTO server_members (server_id, user_id, role_id)
SELECT s.id, u.id,
  (SELECT id FROM roles WHERE server_id = s.id AND (
    CASE u.username 
      WHEN 'Dylan' THEN 'Admin'
      WHEN 'Koda' THEN 'Admin'
      WHEN 'Jayden' THEN 'Staff'
      WHEN 'Squires' THEN 'Staff'
      ELSE 'Member'
    END
  ) = roles.name)
FROM s, users u
ON CONFLICT DO NOTHING;

WITH s AS (SELECT id FROM servers WHERE name='FST [est. 2025]')
INSERT INTO channels (server_id, name, type, category)
SELECT s.id, c.name, 'text', c.category
FROM (VALUES
  ('announcements','Admin'),
  ('rulebook','Admin'),
  ('roles','Staff'),
  ('moderation','Staff'),
  ('chat-room','FST'),
  ('memes','FST'),
  ('media','FST'),
  ('real-f1','FST'),
  ('pets','FST')
) AS c(name, category), s
ON CONFLICT DO NOTHING;

WITH ch AS (SELECT id FROM channels WHERE name='chat-room'),
     u AS (SELECT id, username FROM users)
INSERT INTO messages (channel_id, user_id, content, created_at)
SELECT ch.id,
  (SELECT id FROM users WHERE username = 'Alex'),
  'Message ' || i::text,
  now() + make_interval(secs => i)
FROM ch, generate_series(1,24) AS gs(i)
ON CONFLICT DO NOTHING;
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
