// Synchronization orchestrator: pulls mailbox/message data from a provider
// adapter and upserts it into D1. Handles incremental UID sync, mailbox
// mapping, and body fetching on demand.
//
// v1 runs this on-demand (login, manual refresh, account add). The seam to add
// Cron + Queues later is here (a function that just enqueues an account id).

import { randomUUID } from "crypto";
import { buildProvider } from "../email/providers";
import { roleFromImapName, roleSortOrder } from "../email/providers/role-map";
import type { ProviderMessage } from "../email/providers/types";
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

/**
 * Synchronize one account's mailboxes. Returns a summary that can be surfaced.
 *
 * Guarantees: the account's `state` column always leaves "running" — either to
 * "healthy" or to "unavailable" — even if a provider socket hangs, by racing
 * the sync against a hard time budget.
 */
export async function syncAccount(
  env: Env,
  accountId: string,
): Promise<{ mailboxesSynced: number; messagesSeen: number }> {
  const account = await getAccount(env, accountId);
  if (!account) throw new Error("Account not found");

  await setAccountState(env, accountId, "running", null);

  const timeBudgetMs = parseInt(env.SYNC_TIMEOUT_MS ?? "", 10) || 45_000;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("sync_timeout")), timeBudgetMs);
  });

  try {
    const work = (async () => {
      const credential = await getCredential(env, accountId);
      const provider = await buildProvider(
        account,
        credential ? { credential: credential.credential } : null,
        env,
      );

      const mailboxes = await provider.listMailboxes();
      let mailboxesSynced = 0;
      let messagesSeen = 0;

      for (const mb of mailboxes) {
        const result = await syncOneMailbox(env, provider, account, mb.name);
        mailboxesSynced += result.synced ? 1 : 0;
        messagesSeen += result.seen;
      }
      return { mailboxesSynced, messagesSeen };
    })();

    const result = await Promise.race([work, timeout]);
    clearTimeout(timer);

    // Update account sync timestamp.
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE accounts SET last_synced_at = ?, state = 'healthy', state_message = NULL WHERE id = ?`,
    )
      .bind(now, accountId)
      .run();
    await env.DB.prepare(
      `UPDATE sync_state SET state = 'idle', last_error = NULL, error_count = 0 WHERE account_id = ? AND state = 'error'`,
    )
      .bind(accountId)
      .run();

    return result;
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error && err.message === "sync_timeout"
      ? "Synchronization timed out. The mail server may be slow or unreachable."
      : classifyError(err);
    await setAccountState(env, accountId, "unavailable", message);
    await env.DB.prepare(
      `UPDATE sync_state SET state = 'error', last_error = ?, error_count = error_count + 1 WHERE account_id = ?`,
    )
      .bind(message, accountId)
      .run();
    throw err;
  }
}

async function syncOneMailbox(
  env: Env,
  provider: Awaited<ReturnType<typeof buildProvider>>,
  account: AcctRow,
  mailboxPath: string,
): Promise<{ synced: boolean; seen: number }> {
  // Find/create the mailbox row.
  const mailbox = await upsertMailbox(env, account.id, mailboxPath);

  // Load sync cursors (per-mailbox: UIDs are mailbox-scoped in IMAP).
  const syncRow = await getSyncState(env, account.id, mailbox.id);
  const sinceUid = syncRow?.last_uid ?? 0;
  const uidValidity = syncRow?.uid_validity ?? null;

  const fetchLimit = parseInt(env.SYNC_FETCH_LIMIT ?? "200", 10) || 200;
  const result = await provider.syncMailbox(mailboxPath, {
    sinceUid,
    fetchLimit,
  });

  let added = 0;
  for (const msg of result.messages) {
    await upsertMessage(env, account, mailbox, result.uidValidity, msg);
    added++;
  }

  // Save cursors (per-mailbox).
  await env.DB.prepare(
    `INSERT INTO sync_state (account_id, mailbox_id, uid_validity, last_uid, last_sync_at, state)
     VALUES (?, ?, ?, ?, ?, 'idle')
     ON CONFLICT(account_id, mailbox_id) DO UPDATE SET
       uid_validity = COALESCE(excluded.uid_validity, sync_state.uid_validity),
       last_uid = excluded.last_uid,
       last_sync_at = excluded.last_sync_at,
       state = 'idle'`,
  )
    .bind(account.id, mailbox.id, result.uidValidity ?? uidValidity, result.highestUid, new Date().toISOString())
    .run();

  // Update mailbox stats.
  await env.DB.prepare(
    `UPDATE mailboxes SET total_messages = ?, unseen_messages = ? WHERE id = ?`,
  )
    .bind(result.total ?? null, await unseenForBox(env, mailbox.id), mailbox.id)
    .run();

  return { synced: added > 0 || result.highestUid > 0, seen: added };
}

async function upsertMessage(
  env: Env,
  account: AcctRow,
  mailbox: { id: string },
  uidValidity: number | null,
  msg: ProviderMessage,
): Promise<void> {
  const id = randomUUID();
  const fromName = msg.from?.name ?? null;
  const fromAddress = msg.from?.address ?? null;
  const subject = msg.subject ?? null;
  const date = msg.date ?? null;
  const receivedAt = msg.internalDate ?? new Date().toISOString();
  const isRead = msg.flags.includes("\\Seen");
  const isStarred = msg.flags.includes("\\Flagged");
  const hasAttachments = false; // set when body fetched
  const threadId = msg.messageId ? msg.messageId : null;

  // Compute a sync fingerprint to detect changes.
  const hash = simpleHash(
    [uidValidity, msg.remoteUid, isRead, isStarred, subject, date].join("|"),
  );

  const existing = await env.DB.prepare(
    `SELECT id FROM messages WHERE mailbox_id = ? AND remote_uid = ?`,
  )
    .bind(mailbox.id, msg.remoteUid)
    .first<{ id: string }>();

  if (existing) {
    // Update flags/read state if changed.
    await env.DB.prepare(
      `UPDATE messages SET is_read = ?, is_starred = ?, sync_hash = ?, date = COALESCE(?, date), subject = COALESCE(?, subject) WHERE id = ?`,
    )
      .bind(isRead ? 1 : 0, isStarred ? 1 : 0, hash, date, subject, existing.id)
      .run();
    // recipients rarely change; skip for speed
    return;
  }

  await env.DB.prepare(
    `INSERT INTO messages
      (id, account_id, mailbox_id, remote_uid, remote_message_id, subject,
       from_name, from_address, date, received_at, is_read, is_starred,
       has_attachments, maybe_thread_id, sync_hash, raw_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      account.id,
      mailbox.id,
      msg.remoteUid,
      msg.messageId,
      subject,
      fromName,
      fromAddress,
      date,
      receivedAt,
      isRead ? 1 : 0,
      isStarred ? 1 : 0,
      hasAttachments ? 1 : 0,
      threadId,
      hash,
      msg.size ?? null,
    )
    .run();

  // Recipients.
  for (const r of msg.to ?? []) {
    if (!r.address) continue;
    await env.DB.prepare(
      `INSERT INTO message_recipients (id, message_id, type, name, address) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(randomUUID(), id, "to", r.name, r.address)
      .run();
  }
  for (const r of msg.cc ?? []) {
    if (!r.address) continue;
    await env.DB.prepare(
      `INSERT INTO message_recipients (id, message_id, type, name, address) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(randomUUID(), id, "cc", r.name, r.address)
      .run();
  }
}

async function upsertMailbox(
  env: Env,
  accountId: string,
  path: string,
): Promise<{ id: string }> {
  const existing = await env.DB.prepare(
    `SELECT id, provider_path FROM mailboxes WHERE account_id = ? AND provider_path = ?`,
  )
    .bind(accountId, path)
    .first<{ id: string }>();

  if (existing) return existing;

  const id = randomUUID();
  const role = roleFromImapName(path, []);
  const sortOrder = roleSortOrder(role);
  await env.DB.prepare(
    `INSERT INTO mailboxes (id, account_id, name, role, provider_path, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, accountId, path, role, path, sortOrder)
    .run();
  return { id };
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

async function getSyncState(
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

async function setAccountState(
  env: Env,
  accountId: string,
  state: string,
  message: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE accounts SET state = ?, state_message = ? WHERE id = ?`,
  )
    .bind(state, message, accountId)
    .run();
}

async function unseenForBox(env: Env, mailboxId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM messages WHERE mailbox_id = ? AND is_read = 0`,
  )
    .bind(mailboxId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function classifyError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/login|authentication|AUTHENTICATE|LOGIN/i.test(m)) {
    return "Authentication failed. Check the account password or reauthorize.";
  }
  if (/timeout|timed out|ETIMEDOUT|socket|connection|ECONN/i.test(m)) {
    return "Could not reach the mail server. It may be temporarily unavailable.";
  }
  // Generic but safe
  return "Synchronization failed. Check the server settings.";
}
