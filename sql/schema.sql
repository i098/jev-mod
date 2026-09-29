-- Apply explicitly to a new, empty Jev-Mod database.
CREATE TABLE guild_settings (
  guild_id VARCHAR(20) PRIMARY KEY,
  config JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE moderation_cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  message_id VARCHAR(20) NOT NULL,
  author_id VARCHAR(20) NOT NULL,
  message_hash CHAR(64) NOT NULL,
  policy_version INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  matches JSON NOT NULL,
  model VARCHAR(100),
  requested_action VARCHAR(20) NOT NULL,
  outcome VARCHAR(40) NOT NULL,
  reviewed_by VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY message_revision (guild_id, message_id, message_hash, policy_version),
  INDEX guild_created (guild_id, id),
  INDEX retention (created_at)
) ENGINE=InnoDB;

CREATE TABLE settings_audit (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  actor_id VARCHAR(20) NOT NULL,
  event VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX guild_created (guild_id, id),
  INDEX retention (created_at)
) ENGINE=InnoDB;

CREATE TABLE dashboard_sessions (
  id VARCHAR(128) PRIMARY KEY,
  payload MEDIUMTEXT NOT NULL,
  expires BIGINT NOT NULL,
  INDEX expiry (expires)
) ENGINE=InnoDB;

CREATE TABLE oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  session_hash CHAR(64) NOT NULL,
  expires BIGINT NOT NULL,
  INDEX expiry (expires)
) ENGINE=InnoDB;
