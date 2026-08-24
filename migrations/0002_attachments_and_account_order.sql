-- 0002_attachments_and_account_order.sql
-- Extend attachments with a provider part handle (for on-demand download)
-- and accounts with a user-controlled sort order (for reordering).

ALTER TABLE attachments ADD COLUMN part_number TEXT;

ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_accounts_user_order ON accounts(user_id, sort_order, created_at);