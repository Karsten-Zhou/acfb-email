// Synchronization: pulls mailbox/message changes from a provider adapter and
// applies them to D1. The durable unit of work is a single mailbox
// (syncMailbox); syncAccount discovers an account's mailboxes and runs one
// mailbox sync per folder. The queue consumer in server/index.ts can also
// target a specific mailbox for retries.
//
// Invariants:
//  - A provider cursor only advances after every change it covers has been
//    durably applied — each mailbox's changes and its cursor update land in a
//    single D1 batch.
//  - A provider UID identifies a message's location, never the logical message
//    itself. Logical messages live in `messages`; their presence in a folder
//    lives in `message_locations` keyed by (mailbox_id, uid_validity, uid).

import { randomUUID } from "crypto";
import { buildProvider } from "../email/build-provider";
import { roleFromImapName, roleSortOrder } from "../email/role-map";
import { AbortError } from "../email/imap";
import type { ProviderMailbox, ProviderMessage } from "../email/types";
import type { Env } from "../env";

interface AcctRow {
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

interface CredRow {
  credential: string;
}

interface MailboxRow {
  id: string;
  account_id: string;
  provider_path: string;
}

export interface SyncResult {
  mailboxesSynced: number;
  messagesSeen: number;
  /** True when the sync was stopped by its time budget before finishing. */
  timedOut?: boolean;
}

/**
 * Discover an account's mailboxes and sync each one. Runs within a hard time
 * budget enforced by cooperative cancellation (the loop checks an AbortSignal
 * between provider round-trips), so a hanging provider socket can never leave
 * a competing writer mutating the DB after the caller has moved on.
 */
export async function syncAccount(env: Env, accountId: string): Promise<SyncResult> {
  const account = await getAccount(env, accountId);
  if (!account) throw new Error("Account not found");

  await setAccountState(env, accountId, "running", null);

  const controller = new AbortController();
  const timeBudgetMs = parseInt(env.SYNC_TIMEOUT_MS ?? "", 10) || 480_000;
  const timer = setTimeout(() => controller.abort(), timeBudgetMs);

  let mailboxesSynced = 0;
  let messagesSeen = 0;
  let firstError: string | null = null;

  try {
    const credential = await getCredential(env, accountId);
    const provider = await buildProvider(
      account,
      credential ? { credential: credential.credential } : null,
      env,
    );

    const mailboxes = await provider.listMailboxes();
    for (const mb of mailboxes) {
      if (controller.signal.aborted) throw new AbortError();
      const mailbox = await upsertMailbox(env, accountId, mb);
      try {
        const r = await syncMailbox(env, accountId, mailbox.id, { signal: controller.signal });
        mailboxesSynced += 1;
        messagesSeen += r.seen;
      } catch (err) {
        if (err instanceof AbortError) throw err;
        // A flaky mailbox must not prevent the others from syncing; record the
        // first failure and keep going so each folder can settle independently.
        firstError ??= classifyError(err);
      }
    }

    if (firstError) await markAccountSyncFailed(env, accountId, firstError);
    else await markAccountSyncSucceeded(env, accountId);

    await env.DB.prepare(`UPDATE accounts SET last_synced_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), accountId)
      .run();

    return { mailboxesSynced, messagesSeen };
  } catch (err) {
    if (err instanceof AbortError) {
      // Time budget exhausted: surface the partial result instead of leaving
      // the account stuck in a transient state; the queue retries.
      await markAccountSyncFailed(env, accountId, "errTimeout");
      return { mailboxesSynced, messagesSeen, timedOut: true };
    }
    const message = classifyError(err);
    await markAccountSyncFailed(env, accountId, message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Settle an account as healthy only when no sibling mailbox is in error — a
 * mailbox that failed keeps the account reported as unavailable until it
 * succeeds again. Exported for the per-mailbox queue path.
 */
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

export interface MailboxSyncResult {
  seen: number;
}

/**
 * The durable work unit: sync a single mailbox. Fetches provider changes since
 * the stored cursor, applies them (batched, idempotently), reconciles stale
 * locations, and advances the cursor — atomically with the changes it covers.
 */
export async function syncMailbox(
  env: Env,
  accountId: string,
  mailboxId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MailboxSyncResult> {
  const account = await getAccount(env, accountId);
  if (!account) throw new Error("Account not found");
  const mailbox = await getMailbox(env, mailboxId);
  if (!mailbox) throw new Error("Mailbox not found");
  if (mailbox.account_id !== accountId) throw new Error("Mailbox does not belong to account");

  await setSyncState(env, accountId, mailboxId, "syncing");

  const credential = await getCredential(env, accountId);
  const provider = await buildProvider(
    account,
    credential ? { credential: credential.credential } : null,
    env,
  );

  const cursor = await getSyncCursor(env, accountId, mailboxId);
  const fetchLimit = parseInt(env.SYNC_FETCH_LIMIT ?? "100", 10) || 100;

  let result: Awaited<ReturnType<typeof provider.syncMailbox>>;
  try {
    result = await provider.syncMailbox(
      mailbox.provider_path,
      { sinceUid: cursor?.last_uid ?? 0, fetchLimit },
      opts.signal,
    );
    // A UIDVALIDITY change invalidates every UID we hold for this mailbox.
    // Purge its locations (and now-orphaned messages) and re-import from
    // scratch — otherwise the same numeric UID could refer to a completely
    // different email.
    const uidValidity = result.uidValidity ?? 0;
    if (cursor?.uid_validity != null && cursor.uid_validity !== uidValidity) {
      await env.DB.prepare(`DELETE FROM message_locations WHERE mailbox_id = ?`)
        .bind(mailboxId)
        .run();
      await pruneOrphanMessages(env);
      result = await provider.syncMailbox(
        mailbox.provider_path,
        { sinceUid: 0, fetchLimit },
        opts.signal,
      );
    }
  } catch (err) {
    // An abort is a cancellation, not a mailbox failure — the caller surfaces
    // it as a timeout.
    if (err instanceof AbortError) throw err;
    await markMailboxSyncFailed(env, accountId, mailboxId, err);
    throw err;
  }

  const uidValidity = result.uidValidity ?? 0;

  const now = new Date().toISOString();
  const seen = await applyProviderMessages(
    env,
    account.id,
    mailbox.id,
    uidValidity,
    result.messages,
    // Advance the cursor in the SAME batch as the changes it covers. last_uid
    // never regresses: a sync with no new messages reports highestUid 0, so the
    // cursor keeps its previous value.
    [
      env.DB.prepare(
        `INSERT INTO sync_state (account_id, mailbox_id, uid_validity, last_uid, last_total, state, last_error, error_count, last_sync_at, last_success_at)
         VALUES (?, ?, ?, ?, ?, 'idle', NULL, 0, ?, ?)
         ON CONFLICT(account_id, mailbox_id) DO UPDATE SET
           uid_validity = excluded.uid_validity,
           last_uid = MAX(COALESCE(sync_state.last_uid, 0), COALESCE(excluded.last_uid, 0)),
           last_total = excluded.last_total,
           state = 'idle',
           last_error = NULL,
           error_count = 0,
           last_sync_at = excluded.last_sync_at,
           last_success_at = excluded.last_success_at`,
      ).bind(
        account.id,
        mailbox.id,
        uidValidity,
        result.highestUid,
        result.total ?? null,
        now,
        now,
      ),
    ],
  );

  // Reconcile the mailbox's local locations against the provider's current UID
  // set: a location whose UID is gone belongs to a message that moved away or
  // was deleted. A message that legitimately lives in several folders (e.g. a
  // self-sent mail appears in Inbox AND Sent) is untouched, because its UID is
  // present in each folder's set.
  await reconcileMailboxLocations(env, mailbox.id, result.currentUids);

  // Refresh mailbox stats.
  await env.DB.prepare(`UPDATE mailboxes SET total_messages = ?, unseen_messages = ? WHERE id = ?`)
    .bind(result.total ?? null, await unseenForBox(env, mailbox.id), mailbox.id)
    .run();

  return { seen };
}

/**
 * The logical message id for a provider message. The Message-ID header acts as
 * a dedupe hint: the same email seen in several folders (self-sent, Gmail All
 * Mail) shares one logical row. Without a header, the location itself is the
 * identity. Exported so the move path can re-link a message to its new
 * location.
 */
export function logicalMessageId(
  accountId: string,
  msg: ProviderMessage,
  locationKey: string,
): string {
  return msg.messageId
    ? `m:${simpleHash(accountId + "\n" + msg.messageId)}`
    : `l:${simpleHash(accountId + "\n" + locationKey)}`;
}

/**
 * Apply a set of provider messages to a mailbox: one logical-message upsert +
 * one location upsert per message, all in a single batch (plus any extra
 * statements the caller needs to run atomically with them). Recipients are
 * written only for messages created by this pass, keeping re-syncs idempotent.
 * Returns the number of messages seen.
 */
async function applyProviderMessages(
  env: Env,
  accountId: string,
  mailboxId: string,
  uidValidity: number,
  messages: ProviderMessage[],
  extraStatements: D1PreparedStatement[] = [],
): Promise<number> {
  if (messages.length === 0 && extraStatements.length === 0) return 0;

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const newMessageIds = new Set<string>();

  const ids = [
    ...new Set(
      messages.map((m) =>
        logicalMessageId(accountId, m, locationKey(mailboxId, uidValidity, m.remoteUid)),
      ),
    ),
  ];
  const existing = ids.length > 0 ? await existingMessageIds(env, ids) : new Set<string>();
  for (const msg of messages) {
    const messageId = logicalMessageId(
      accountId,
      msg,
      locationKey(mailboxId, uidValidity, msg.remoteUid),
    );
    if (!existing.has(messageId)) newMessageIds.add(messageId);
  }

  for (const msg of messages) {
    const messageId = logicalMessageId(
      accountId,
      msg,
      locationKey(mailboxId, uidValidity, msg.remoteUid),
    );
    statements.push(messageUpsert(env, accountId, messageId, msg, now));
    statements.push(locationUpsert(env, mailboxId, messageId, uidValidity, msg, now));
  }
  statements.push(...extraStatements);

  await env.DB.batch(statements);

  if (newMessageIds.size > 0) {
    const recipients: D1PreparedStatement[] = [];
    for (const msg of messages) {
      const messageId = logicalMessageId(
        accountId,
        msg,
        locationKey(mailboxId, uidValidity, msg.remoteUid),
      );
      if (!newMessageIds.has(messageId)) continue;
      for (const r of msg.to ?? []) {
        if (!r.address) continue;
        recipients.push(
          env.DB.prepare(
            `INSERT INTO message_recipients (id, message_id, type, name, address) VALUES (?, ?, 'to', ?, ?)`,
          ).bind(randomUUID(), messageId, r.name, r.address),
        );
      }
      for (const r of msg.cc ?? []) {
        if (!r.address) continue;
        recipients.push(
          env.DB.prepare(
            `INSERT INTO message_recipients (id, message_id, type, name, address) VALUES (?, ?, 'cc', ?, ?)`,
          ).bind(randomUUID(), messageId, r.name, r.address),
        );
      }
    }
    if (recipients.length > 0) await env.DB.batch(recipients);
  }

  return messages.length;
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
  // Normalize to ISO-8601 so cross-provider sorts are consistent (IMAP
  // INTERNALDATE is "d-MMM-yyyy …" which sorts lexically above ISO dates).
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

async function existingMessageIds(env: Env, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const batch of chunk(ids, 500)) {
    const ph = batch.map(() => "?").join(",");
    const rows = await env.DB.prepare(`SELECT id FROM messages WHERE id IN (${ph})`)
      .bind(...batch)
      .all<{ id: string }>();
    for (const r of rows.results) found.add(r.id);
  }
  return found;
}

/**
 * Reconcile a mailbox's local locations against the provider's authoritative
 * UID set. A location whose UID is no longer present belongs to a message that
 * moved away or was deleted, so it is removed; orphaned logical messages are
 * pruned. Returns the number of locations removed.
 */
export async function reconcileMailboxLocations(
  env: Env,
  mailboxId: string,
  currentUids: number[],
): Promise<number> {
  if (currentUids.length === 0) {
    const r = await env.DB.prepare(`DELETE FROM message_locations WHERE mailbox_id = ?`)
      .bind(mailboxId)
      .run();
    await pruneOrphanMessages(env);
    return r.meta.changes ?? 0;
  }
  const present = new Set(currentUids);
  const local = await env.DB.prepare(`SELECT id, uid FROM message_locations WHERE mailbox_id = ?`)
    .bind(mailboxId)
    .all<{ id: string; uid: number }>();
  const stale = local.results.filter((row) => !present.has(row.uid));
  if (stale.length === 0) return 0;

  let removed = 0;
  for (const ids of chunk(
    stale.map((r) => r.id),
    500,
  )) {
    const ph = ids.map(() => "?").join(",");
    const r = await env.DB.prepare(`DELETE FROM message_locations WHERE id IN (${ph})`)
      .bind(...ids)
      .run();
    removed += r.meta.changes ?? 0;
  }
  await pruneOrphanMessages(env);
  return removed;
}

/** Delete logical messages that have no remaining location anywhere. */
export async function pruneOrphanMessages(env: Env): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM messages
     WHERE NOT EXISTS (SELECT 1 FROM message_locations ml WHERE ml.message_id = messages.id)`,
  ).run();
}

/**
 * Import an older page from the provider for a mailbox. Used by the load-older
 * path when the local DB page is exhausted. Does not reconcile (load-older
 * must never delete rows). Returns the messages imported.
 */
export async function importOlderPage(
  env: Env,
  account: { id: string; provider: string },
  mailboxPath: string,
  beforeUid: number,
  limit: number,
): Promise<{ imported: number; hasMore: boolean }> {
  const fullAccount = await getAccount(env, account.id);
  if (!fullAccount) return { imported: 0, hasMore: false };
  const credential = await getCredential(env, account.id);
  const provider = await buildProvider(
    fullAccount,
    credential ? { credential: credential.credential } : null,
    env,
  );
  const result = await provider.fetchOlder(mailboxPath, {
    beforeUid,
    fetchLimit: limit,
  });
  // The mailbox already exists (created during the initial sync, where its
  // role was resolved); this just looks it up by provider path.
  const mailbox = await upsertMailbox(env, account.id, {
    name: mailboxPath,
    delimiter: null,
    flags: [],
  });
  const cursor = await getSyncCursor(env, account.id, mailbox.id);
  const uidValidity = cursor?.uid_validity ?? 0;
  await applyProviderMessages(env, account.id, mailbox.id, uidValidity, result.messages);
  // Refresh the aggregate counts (unseen changes as older messages arrive).
  const total = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM message_locations WHERE mailbox_id = ?`,
  )
    .bind(mailbox.id)
    .first<{ n: number }>();
  await env.DB.prepare(`UPDATE mailboxes SET total_messages = ?, unseen_messages = ? WHERE id = ?`)
    .bind(total?.n ?? 0, await unseenForBox(env, mailbox.id), mailbox.id)
    .run();
  return { imported: result.messages.length, hasMore: result.messages.length > 0 };
}

async function upsertMailbox(
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

async function getAccount(env: Env, accountId: string): Promise<AcctRow | null> {
  return env.DB.prepare(
    `SELECT id, provider, email, display_name, imap_host, imap_port, imap_secure,
            smtp_host, smtp_port, smtp_secure, state, state_message
     FROM accounts WHERE id = ?`,
  )
    .bind(accountId)
    .first<AcctRow>();
}

async function getCredential(env: Env, accountId: string): Promise<CredRow | null> {
  return env.DB.prepare(`SELECT credential FROM account_credentials WHERE account_id = ?`)
    .bind(accountId)
    .first<CredRow>();
}

async function getMailbox(env: Env, mailboxId: string): Promise<MailboxRow | null> {
  return env.DB.prepare(`SELECT id, account_id, provider_path FROM mailboxes WHERE id = ?`)
    .bind(mailboxId)
    .first<MailboxRow>();
}

async function getSyncCursor(
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

async function setSyncState(
  env: Env,
  accountId: string,
  mailboxId: string,
  state: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE sync_state SET state = ? WHERE account_id = ? AND mailbox_id = ?`)
    .bind(state, accountId, mailboxId)
    .run();
}

async function markMailboxSyncFailed(
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
    .bind(message, new Date().toISOString(), accountId, mailboxId)
    .run();
  await markAccountSyncFailed(env, accountId, classifyError(err));
}

async function setAccountState(
  env: Env,
  accountId: string,
  state: string,
  message: string | null,
): Promise<void> {
  await env.DB.prepare(`UPDATE accounts SET state = ?, state_message = ? WHERE id = ?`)
    .bind(state, message, accountId)
    .run();
}

async function unseenForBox(env: Env, mailboxId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM message_locations WHERE mailbox_id = ? AND is_read = 0`,
  )
    .bind(mailboxId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

function locationKey(mailboxId: string, uidValidity: number, uid: number): string {
  return `${mailboxId}|${uidValidity}|${uid}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Parse a provider date string into ISO-8601 (UTC), or null. */
function isoDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = new Date(raw);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function classifyError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/basic authentication is disabled/i.test(m)) return "errOauthRequired";
  if (/login|authentication|AUTHENTICATE|LOGIN/i.test(m)) return "errAuth";
  if (/timeout|timed out|ETIMEDOUT|socket|connection|ECONN/i.test(m)) return "errNetwork";
  // IMAP/SMTP errors already carry a usable detail (server reply text).
  if (m.includes(" — ") || /\(\d{3}\)/.test(m)) return m;
  return "errSyncFailed";
}
