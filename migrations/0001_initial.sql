-- Initial schema for the Cloudflare email client.

-- ------------------------------------------------------------------
-- users: application identity (one per allowed GitHub account)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,            -- uuid (crypto.randomUUID)
  github_id     INTEGER NOT NULL UNIQUE,
  github_login  TEXT NOT NULL,
  display_name  TEXT,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ------------------------------------------------------------------
-- sessions: server-side login sessions (short-lived, revocable)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,               -- the opaque session token (hashed)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ------------------------------------------------------------------
-- accounts: connected email accounts (provider-agnostic metadata)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,           -- uuid
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,              -- 'imap' | 'gmail' | 'microsoft' | 'pop3'
  name           TEXT NOT NULL,              -- user label, e.g. "Work"
  email          TEXT NOT NULL,
  display_name   TEXT,

  -- transport config (nullable until provider fills it)
  imap_host      TEXT,
  imap_port      INTEGER,
  imap_secure    INTEGER NOT NULL DEFAULT 1, -- 1 = implicit TLS
  smtp_host      TEXT,
  smtp_port      INTEGER,
  smtp_secure    INTEGER NOT NULL DEFAULT 1,

  -- state machine
  state          TEXT NOT NULL DEFAULT 'healthy',             -- see ACCOUNT_STATES
  state_message  TEXT,                                        -- human reason
  sync_enabled   INTEGER NOT NULL DEFAULT 1,

  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_synced_at TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0   -- user-controlled display order
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user_order ON accounts(user_id, sort_order, created_at);

-- ------------------------------------------------------------------
-- account_credentials: encrypted secrets (AES-GCM). Separated so the
-- plaintext is never co-located with account metadata in queries.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_credentials (
  account_id   TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- base64(iv + ciphertext + authTag) for the username/email login
  credential   TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ------------------------------------------------------------------
-- mailboxes: folders within an account
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailboxes (
  id             TEXT PRIMARY KEY,           -- uuid
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'other',  -- see MAILBOX_ROLES
  provider_path  TEXT,                       -- e.g. IMAP mailbox name "INBOX"
  delimiter      TEXT,                       -- path delimiter character
  total_messages INTEGER,
  unseen_messages INTEGER,
  sort_order     INTEGER NOT NULL DEFAULT 100,
  UNIQUE (account_id, provider_path)
);
CREATE INDEX IF NOT EXISTS idx_mailboxes_account ON mailboxes(account_id);

-- ------------------------------------------------------------------
-- messages: mailbox message metadata (+ sanitized/quoted content later)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,          -- uuid (internal stable id)
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mailbox_id      TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  remote_uid      INTEGER,                   -- IMAP UID (per mailbox)
  remote_message_id TEXT,                    -- Message-ID header
  subject         TEXT,
  snippet         TEXT,
  -- denormalized sender for fast listing
  from_name       TEXT,
  from_address    TEXT,
  date            TEXT,                      -- server Date
  received_at     TEXT NOT NULL,
  is_read         INTEGER NOT NULL DEFAULT 0,
  is_starred      INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  maybe_thread_id TEXT,
  -- sanitized/quoted plain & HTML previews (small); full body fetched on demand
  text_preview    TEXT,
  html_preview    TEXT,
  body_fetched    INTEGER NOT NULL DEFAULT 0,
  raw_size        INTEGER,                   -- approximate bytes
  sync_hash       TEXT,                      -- fingerprint to detect change
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox ON messages(mailbox_id, received_at);
CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(account_id);
CREATE INDEX IF NOT EXISTS idx_messages_remote ON messages(mailbox_id, remote_uid);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(maybe_thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(mailbox_id, is_read);

-- ------------------------------------------------------------------
-- message_recipients: to/cc/bcc of each message
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_recipients (
  id         TEXT PRIMARY KEY,               -- uuid
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                  -- 'to' | 'cc' | 'bcc'
  name       TEXT,
  address    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipients_message ON message_recipients(message_id);

-- ------------------------------------------------------------------
-- attachments: metadata (and small content in R2 in later phase)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,               -- uuid
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename   TEXT,
  mime_type  TEXT,
  size       INTEGER NOT NULL DEFAULT 0,
  is_inline  INTEGER NOT NULL DEFAULT 0,
  content_id TEXT,
  disposition TEXT,
  part_number TEXT                          -- provider part handle for on-demand download
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

-- ------------------------------------------------------------------
-- sync_state: per-mailbox synchronization bookkeeping.
-- UIDs are per-mailbox in IMAP, so the cursor is keyed by (account, mailbox).
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mailbox_id      TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  uid_validity    INTEGER,                   -- IMAP UIDVALIDITY
  last_uid        INTEGER,                   -- highest seen UID in this mailbox
  last_sync_at    TEXT,
  next_sync_at    TEXT,
  state           TEXT NOT NULL DEFAULT 'idle',   -- idle|running|error
  last_error      TEXT,
  error_count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, mailbox_id)
);

-- ------------------------------------------------------------------
-- push_subscriptions: browser push subscriptions (per user/account)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,              -- uuid
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- ------------------------------------------------------------------
-- app_settings: per-user settings (JSON blob) + drafts
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS drafts (
  id         TEXT PRIMARY KEY,               -- uuid
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  to_json    TEXT NOT NULL DEFAULT '[]',
  cc_json    TEXT NOT NULL DEFAULT '[]',
  bcc_json   TEXT NOT NULL DEFAULT '[]',
  subject    TEXT,
  html       TEXT,
  text       TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id);
