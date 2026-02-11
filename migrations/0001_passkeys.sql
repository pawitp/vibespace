CREATE TABLE IF NOT EXISTS passkey_credentials (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'ES256',
  counter INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  transports_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS registration_tokens (
  token TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
