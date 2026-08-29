-- Initial schema for the Cloudflare email client.

-- ------------------------------------------------------------------
-- accounts: connected email accounts (provider-agnostic metadata).
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,           -- uuid
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
CREATE INDEX IF NOT EXISTS idx_accounts_order ON accounts(sort_order, created_at);

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
-- messages: the logical email. A message may appear in several mailboxes
-- at once (e.g. a self-sent mail lives in Inbox AND Sent); its presence in
-- a specific mailbox is modelled by message_locations, which also carries
-- the per-mailbox provider identity (IMAP UID + UIDVALIDITY) and the
-- per-location read/starred flags.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,          -- internal stable id
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject         TEXT,
  snippet         TEXT,
  -- denormalized sender for fast listing
  from_name       TEXT,
  from_address    TEXT,
  date            TEXT,                      -- server Date
  received_at     TEXT NOT NULL,
  maybe_thread_id TEXT,                      -- Message-ID header (threading hint)
  has_attachments INTEGER NOT NULL DEFAULT 0,
  -- sanitized/quoted plain & HTML previews (small); full body fetched on demand
  text_preview    TEXT,
  html_preview    TEXT,
  body_fetched    INTEGER NOT NULL DEFAULT 0,
  raw_size        INTEGER,                   -- approximate bytes
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(account_id);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(maybe_thread_id);

-- ------------------------------------------------------------------
-- message_locations: a message's presence in a mailbox, plus its provider
-- identity there. IMAP UIDs are only meaningful within (mailbox, UIDVALIDITY),
-- so a UID identifies a location, never the logical message itself.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_locations (
  id           TEXT PRIMARY KEY,             -- uuid
  message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  mailbox_id   TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  uid          INTEGER NOT NULL,             -- IMAP UID (per mailbox)
  uid_validity INTEGER NOT NULL DEFAULT 0,   -- IMAP UIDVALIDITY
  is_read      INTEGER NOT NULL DEFAULT 0,
  is_starred   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (mailbox_id, uid_validity, uid)
);
CREATE INDEX IF NOT EXISTS idx_locations_message ON message_locations(message_id);
CREATE INDEX IF NOT EXISTS idx_locations_mailbox ON message_locations(mailbox_id, is_read);

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
-- sync_state: per-mailbox synchronization cursor. Keyed by
-- (account, mailbox) because IMAP UIDs are per-mailbox. The cursor
-- (uid_validity + last_uid) only ever advances after every change it covers
-- has been durably applied.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mailbox_id      TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  uid_validity    INTEGER,                   -- IMAP UIDVALIDITY
  last_uid        INTEGER,                   -- highest UID durably synced in this mailbox
  last_total      INTEGER,                   -- last known EXISTS count (reconcile hint)
  state           TEXT NOT NULL DEFAULT 'idle',   -- idle|syncing|error
  last_error      TEXT,
  error_count     INTEGER NOT NULL DEFAULT 0,
  last_sync_at    TEXT,
  last_success_at TEXT,
  PRIMARY KEY (account_id, mailbox_id)
);

-- ------------------------------------------------------------------
-- push_subscriptions: browser push subscriptions (per account)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,              -- uuid
  account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (endpoint)
);

-- ------------------------------------------------------------------
-- app_settings: app-wide settings (JSON blob, single row)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  data   TEXT NOT NULL DEFAULT '{}'
);
