CREATE UNIQUE INDEX IF NOT EXISTS idx_users_shoo_sub_unique
  ON users(shoo_sub) WHERE shoo_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_metrics_created_at
  ON system_metrics(created_at);

CREATE INDEX IF NOT EXISTS idx_server_members_user_server
  ON server_members(user_id, server_id);

CREATE INDEX IF NOT EXISTS idx_server_member_roles_user_server
  ON server_member_roles(user_id, server_id);

CREATE INDEX IF NOT EXISTS idx_server_member_roles_server_user
  ON server_member_roles(server_id, user_id);

CREATE INDEX IF NOT EXISTS idx_channel_members_user_channel
  ON channel_members(user_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_channels_type_id
  ON channels(type, id);

CREATE INDEX IF NOT EXISTS idx_channels_server_name
  ON channels(server_id, name);

CREATE INDEX IF NOT EXISTS idx_channels_server_category_name
  ON channels(server_id, category, name);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created_at
  ON messages(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_role
  ON channel_permissions(channel_id, role_id);

CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_send
  ON channel_permissions(channel_id, can_send_messages);

CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_view
  ON channel_permissions(channel_id, can_view);

CREATE INDEX IF NOT EXISTS idx_roles_server_position
  ON roles(server_id, position);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

CREATE INDEX IF NOT EXISTS idx_friendships_user1_status_updated
  ON friendships(user_id_1, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_friendships_user2_status_updated
  ON friendships(user_id_2, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_friendships_action_status
  ON friendships(action_user_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_channel_read
  ON notifications(user_id, channel_id, read);

DO $$
DECLARE
  user_row RECORD;
  discrim TEXT;
  attempt_count INT;
  server_row RECORD;
  owner_role_id UUID;
  member_role_id UUID;
BEGIN
  FOR user_row IN SELECT id, username FROM users WHERE discriminator IS NULL LOOP
    discrim := lpad((floor(random() * 10000))::INT::TEXT, 4, '0');
    attempt_count := 0;
    WHILE attempt_count < 10 LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM users
        WHERE username = user_row.username AND discriminator = discrim
      );
      discrim := lpad((floor(random() * 10000))::INT::TEXT, 4, '0');
      attempt_count := attempt_count + 1;
    END LOOP;
    UPDATE users SET discriminator = discrim WHERE id = user_row.id;
  END LOOP;

  FOR server_row IN SELECT id, owner_id FROM servers LOOP
    SELECT id INTO owner_role_id
    FROM roles
    WHERE server_id = server_row.id AND name = 'Owner'
    LIMIT 1;

    IF owner_role_id IS NULL THEN
      INSERT INTO roles (
        server_id,
        name,
        color,
        display_group,
        can_manage_channels,
        can_manage_server,
        can_manage_roles,
        position
      )
      VALUES (server_row.id, 'Owner', '#ff0000', 'Owner', TRUE, TRUE, TRUE, 0)
      RETURNING id INTO owner_role_id;
    END IF;

    SELECT id INTO member_role_id
    FROM roles
    WHERE server_id = server_row.id AND name = 'Member'
    LIMIT 1;

    IF member_role_id IS NULL THEN
      INSERT INTO roles (
        server_id,
        name,
        color,
        display_group,
        can_manage_channels,
        can_manage_server,
        can_manage_roles,
        position
      )
      VALUES (server_row.id, 'Member', '#99aab5', 'Member', FALSE, FALSE, FALSE, 1)
      RETURNING id INTO member_role_id;
    END IF;

    UPDATE server_members
    SET role_id = owner_role_id
    WHERE server_id = server_row.id
      AND user_id = server_row.owner_id
      AND role_id IS NULL;

    UPDATE server_members
    SET role_id = member_role_id
    WHERE server_id = server_row.id
      AND user_id <> server_row.owner_id
      AND role_id IS NULL;
  END LOOP;

  INSERT INTO server_member_roles (server_id, user_id, role_id)
  SELECT server_id, user_id, role_id
  FROM server_members
  WHERE role_id IS NOT NULL
  ON CONFLICT DO NOTHING;
END $$;

