// D1 persistence for the sync engine: builds and executes the statements that
// apply provider data to the local store. Each mailbox's changes and its cursor
// advance are batched together — chunked to stay within D1's per-batch
// statement cap, with the cursor always in the FINAL batch — so a cursor never
// advances past work that wasn't durably applied.

import { randomUUID } from "crypto";
import { roleFromImapName, roleSortOrder } from "../email/role-map";
import type { ProviderMailbox, ProviderMessage } from "../email/types";
import type { Env } from "../env";

export interface AcctRow {
  id: string;
  provider: string;
  email: string;
  display_name: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: number | null;
  state: string;
  state_message: string | null;
}

export interface CredRow {
  credential: string;
}

export interface MailboxRow {
  id: string;
  account_id: string;
  provider_path: string;
}

/** Keep each batch well under D1's per-batch statement cap. */
const BATCH_BUDGET = 90;

// ---------------------------------------------------------------------------
// account / credential / mailbox getters
// ---------------------------------------------------------------------------

export async function getAccount(env: Env, accountId: string): Promise<AcctRow | null> {
  return env.DB.prepare(
    `SELECT id, provider, email, display_name, imap_host, imap_port, imap_secure,
            smtp_host, smtp_port, smtp_secure, state, state_message
     FROM accounts WHERE id = ?`,
  )
    .bind(accountId)
    .first<AcctRow>();
}

export async function getCredential(env: Env, accountId: string): Promise<CredRow | null> {
  return env.DB.prepare(`SELECT credential FROM account_credentials WHERE account_id = ?`)
    .bind(accountId)
    .first<CredRow>();
}

export async function getMailbox(env: Env, mailboxId: string): Promise<MailboxRow | null> {
  return env.DB.prepare(`SELECT id, account_id, provider_path FROM mailboxes WHERE id = ?`)
    .bind(mailboxId)
    .first<MailboxRow>();
}

export async function getSyncCursor(
  env: Env,
  accountId: string,
  mailboxId: string,
): Promise<{ last_uid: number | null; uid_validity: number | null } | null> {
  return env.DB.prepare(
    `SELECT last_uid, uid_validity FROM sync_state WHERE account_id = ? AND mailbox_id = ?`,
  )
    .bind(accountId, mailboxId)
    .first<{ last_uid: number | null; uid_validity: number | null }>();
}

// ---------------------------------------------------------------------------
// account / mailbox state
// ---------------------------------------------------------------------------

export async function setAccountState(
  env: Env,
  accountId: string,
  state: string,
  message: string | null,
): Promise<void> {
  await env.DB.prepare(`UPDATE accounts SET state = ?, state_message = ? WHERE id = ?`)
    .bind(state, message, accountId)
    .run();
}

/** Settle an account as healthy only when no sibling mailbox is in error. */
export async function markAccountSyncSucceeded(env: Env, accountId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE accounts SET state = 'healthy', state_message = NULL WHERE id = ?
     AND NOT EXISTS (SELECT 1 FROM sync_state WHERE account_id = ? AND state = 'error')`,
  )
    .bind(accountId, accountId)
    .run();
}

/** Mark an account unavailable with a classified reason (see classifyError). */
export async function markAccountSyncFailed(
  env: Env,
  accountId: string,
  message: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE accounts SET state = 'unavailable', state_message = ? WHERE id = ?`)
    .bind(message, accountId)
    .run();
}

export async function setSyncState(
  env: Env,
  accountId: string,
  mailboxId: string,
  state: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE sync_state SET state = ? WHERE account_id = ? AND mailbox_id = ?`)
    .bind(state, accountId, mailboxId)
    .run();
}

/** Record a mailbox sync failure and settle the account state. */
export async function markMailboxSyncFailed(
  env: Env,
  accountId: string,
  mailboxId: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  // Upsert so a mailbox that fails before its first cursor write still records
  // an error row (the account-level healthy guard depends on it).
  await env.DB.prepare(
    `INSERT INTO sync_state (account_id, mailbox_id, state, last_error, error_count, last_sync_at)
     VALUES (?, ?, 'error', ?, 1, ?)
     ON CONFLICT(account_id, mailbox_id) DO UPDATE SET
       state = 'error',
       last_error = excluded.last_error,
       error_count = error_count + 1,
       last_sync_at = excluded.last_sync_at`,
  )
    .bind(accountId, mailboxId, message, new Date().toISOString())
    .run();
  await markAccountSyncFailed(env, accountId, classifyError(err));
}

// ---------------------------------------------------------------------------
// mailbox upsert
// ---------------------------------------------------------------------------

export async function upsertMailbox(
  env: Env,
  accountId: string,
  mb: ProviderMailbox,
): Promise<{ id: string; role: string }> {
  const existing = await env.DB.prepare(
    `SELECT id, role, provider_path FROM mailboxes WHERE account_id = ? AND provider_path = ?`,
  )
    .bind(accountId, mb.name)
    .first<{ id: string; role: string }>();

  if (existing) {
    // Re-derive the role so SPECIAL-USE-based detection applies to
    // already-synced mailboxes too.
    const role = mb.role ?? roleFromImapName(mb.name, mb.flags);
    if (existing.role !== role) {
      await env.DB.prepare(`UPDATE mailboxes SET role = ?, sort_order = ? WHERE id = ?`)
        .bind(role, roleSortOrder(role), existing.id)
        .run();
    }
    return existing;
  }

  const id = randomUUID();
  // Provider paths are already Unicode (imapflow decodes modified UTF-7).
  const displayName = mb.name;
  // The provider's detected role comes from the SPECIAL-USE attributes, so it
  // stays correct regardless of the folder's localized name.
  const role = mb.role ?? roleFromImapName(displayName, mb.flags);
  const sortOrder = roleSortOrder(role);
  await env.DB.prepare(
    `INSERT INTO mailboxes (id, account_id, name, role, provider_path, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, accountId, displayName, role, mb.name, sortOrder)
    .run();
  return { id, role };
}

// ---------------------------------------------------------------------------
// logical identity
// ---------------------------------------------------------------------------

export function locationKey(mailboxId: string, uidValidity: number, uid: number): string {
  return `${mailboxId}|${uidValidity}|${uid}`;
}

/**
 * The logical message id for a provider message. The Message-ID header acts as
 * a dedupe hint: the same email seen in several folders (self-sent, Gmail All
 * Mail) shares one logical row. Without a header, the location itself is the
 * identity. The location remains authoritative — keyed by
 * (mailbox, uid_validity, uid) — and re-points to the latest logical message
 * if the provider ever changes the Message-ID for a given UID.
 */
export async function logicalMessageId(
  accountId: string,
  msg: ProviderMessage,
  locKey: string,
): Promise<string> {
  return msg.messageId
    ? `m:${await sha256Hex(`${accountId}\n${msg.messageId}`)}`
    : `l:${await sha256Hex(`${accountId}\n${locKey}`)}`;
}

// ---------------------------------------------------------------------------
// applying a provider pass
// ---------------------------------------------------------------------------

/**
 * Apply a set of provider messages to a mailbox: one logical-message upsert +
 * one location upsert + recipient upserts per message, all batched together so
 * the mailbox's representation is updated atomically. `extraStatements` (the
 * cursor advance, and the purge DELETE on a UIDVALIDITY reset) always land in
 * the FINAL batch, so a cursor never advances past work that wasn't applied.
 *
 * Batches are chunked to stay within D1's per-batch statement cap; a crash
 * between batches is safe because every statement is idempotent (the messages
 * already applied are simply re-processed on the next sync). Recipients are
 * written with INSERT OR IGNORE against a UNIQUE(message_id, type, address)
 * constraint, so re-applying the same message never duplicates them. Returns
 * the number of messages seen.
 */
export async function applyProviderMessages(
  env: Env,
  accountId: string,
  mailboxId: string,
  uidValidity: number,
  messages: ProviderMessage[],
  extraStatements: D1PreparedStatement[] = [],
): Promise<number> {
  if (messages.length === 0 && extraStatements.length === 0) return 0;

  const now = new Date().toISOString();
  const batches: D1PreparedStatement[][] = [];
  let current: D1PreparedStatement[] = [];
  const flush = () => {
    if (current.length > 0) {
      batches.push(current);
      current = [];
    }
  };

  for (const msg of messages) {
    const messageId = await logicalMessageId(
      accountId,
      msg,
      locationKey(mailboxId, uidValidity, msg.remoteUid),
    );
    const group = [
      messageUpsert(env, accountId, messageId, msg, now),
      locationUpsert(env, mailboxId, messageId, uidValidity, msg, now),
      ...recipientUpserts(env, messageId, msg),
    ];
    if (current.length + group.length > BATCH_BUDGET) flush();
    current.push(...group);
  }

  if (current.length + extraStatements.length > BATCH_BUDGET) flush();
  current.push(...extraStatements);
  batches.push(current);

  for (const batch of batches) await env.DB.batch(batch);
  return messages.length;
}

/**
 * The statement that advances a mailbox's sync cursor. Must be batched together
 * with the changes it covers. On a UIDVALIDITY reset the previous last_uid
 * belongs to a different UID space, so the cursor starts fresh; otherwise it
 * never regresses (a no-change sync reports highestUid 0).
 */
export function syncCursorUpsert(
  env: Env,
  accountId: string,
  mailboxId: string,
  uidValidity: number,
  highestUid: number,
  total: number | null,
  now: string,
  reset: boolean,
): D1PreparedStatement {
  const lastUidClause = reset
    ? `last_uid = excluded.last_uid`
    : `last_uid = MAX(COALESCE(sync_state.last_uid, 0), COALESCE(excluded.last_uid, 0))`;
  return env.DB.prepare(
    `INSERT INTO sync_state (account_id, mailbox_id, uid_validity, last_uid, last_total, state, last_error, error_count, last_sync_at, last_success_at)
     VALUES (?, ?, ?, ?, ?, 'idle', NULL, 0, ?, ?)
     ON CONFLICT(account_id, mailbox_id) DO UPDATE SET
       uid_validity = excluded.uid_validity,
       ${lastUidClause},
       last_total = excluded.last_total,
       state = 'idle',
       last_error = NULL,
       error_count = 0,
       last_sync_at = excluded.last_sync_at,
       last_success_at = excluded.last_success_at`,
  ).bind(accountId, mailboxId, uidValidity, highestUid, total, now, now);
}

function messageUpsert(
  env: Env,
  accountId: string,
  id: string,
  msg: ProviderMessage,
  now: string,
): D1PreparedStatement {
  const fromName = msg.from?.name ?? null;
  const fromAddress = msg.from?.address ?? null;
  const subject = msg.subject ?? null;
  const date = msg.date ?? null;
  // Normalize to ISO-8601 so sorts are consistent (IMAP INTERNALDATE is
  // "d-MMM-yyyy …" which sorts lexically above ISO dates).
  const receivedAt = isoDate(msg.internalDate) ?? isoDate(msg.date) ?? now;
  const threadId = msg.messageId ? msg.messageId : null;
  const hasAttachments = msg.hasAttachments === true ? 1 : 0;
  return env.DB.prepare(
    `INSERT INTO messages
      (id, account_id, subject, from_name, from_address, date, received_at,
       maybe_thread_id, has_attachments, raw_size, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       subject = excluded.subject,
       from_name = excluded.from_name,
       from_address = excluded.from_address,
       date = COALESCE(excluded.date, messages.date),
       received_at = COALESCE(excluded.received_at, messages.received_at),
       maybe_thread_id = COALESCE(excluded.maybe_thread_id, messages.maybe_thread_id),
       has_attachments = MAX(messages.has_attachments, excluded.has_attachments),
       raw_size = COALESCE(excluded.raw_size, messages.raw_size),
       updated_at = excluded.updated_at`,
  ).bind(
    id,
    accountId,
    subject,
    fromName,
    fromAddress,
    date,
    receivedAt,
    threadId,
    hasAttachments,
    msg.size ?? null,
    now,
  );
}

function locationUpsert(
  env: Env,
  mailboxId: string,
  messageId: string,
  uidValidity: number,
  msg: ProviderMessage,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO message_locations (id, message_id, mailbox_id, uid, uid_validity, is_read, is_starred, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mailbox_id, uid_validity, uid) DO UPDATE SET
       message_id = excluded.message_id,
       is_read = excluded.is_read,
       is_starred = excluded.is_starred,
       updated_at = excluded.updated_at`,
  ).bind(
    randomUUID(),
    messageId,
    mailboxId,
    msg.remoteUid,
    uidValidity,
    msg.flags.includes("\\Seen") ? 1 : 0,
    msg.flags.includes("\\Flagged") ? 1 : 0,
    now,
  );
}

function recipientUpserts(
  env: Env,
  messageId: string,
  msg: ProviderMessage,
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (const r of msg.to ?? []) {
    if (!r.address) continue;
    out.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO message_recipients (id, message_id, type, name, address) VALUES (?, ?, 'to', ?, ?)`,
      ).bind(randomUUID(), messageId, r.name, r.address),
    );
  }
  for (const r of msg.cc ?? []) {
    if (!r.address) continue;
    out.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO message_recipients (id, message_id, type, name, address) VALUES (?, ?, 'cc', ?, ?)`,
      ).bind(randomUUID(), messageId, r.name, r.address),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export async function unseenForBox(env: Env, mailboxId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM message_locations WHERE mailbox_id = ? AND is_read = 0`,
  )
    .bind(mailboxId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export function classifyError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/basic authentication is disabled/i.test(m)) return "errOauthRequired";
  if (/login|authentication|AUTHENTICATE|LOGIN/i.test(m)) return "errAuth";
  if (/timeout|timed out|ETIMEDOUT|socket|connection|ECONN/i.test(m)) return "errNetwork";
  // IMAP/SMTP errors already carry a usable detail (server reply text).
  if (m.includes(" — ") || /\(\d{3}\)/.test(m)) return m;
  return "errSyncFailed";
}

/** Parse a provider date string into ISO-8601 (UTC), or null. */
function isoDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = new Date(raw);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Collision-resistant, deterministic hex digest (Web Crypto, Workers-safe). */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
