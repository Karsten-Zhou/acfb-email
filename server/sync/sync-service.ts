// Synchronization orchestrator: discovers an account's mailboxes and syncs
// each one. The durable unit of work is a single mailbox (syncMailbox);
// syncAccount discovers mailboxes and runs one mailbox sync per folder. The
// queue consumer in server/index.ts can also target a specific mailbox for
// retries.
//
// Invariants:
//  - A provider cursor only advances after every change it covers has been
//    durably applied — changes and the cursor update share a batch (see
//    sync-persistence.ts).
//  - A provider UID identifies a message's location, never the logical message
//    itself. Logical messages live in `messages`; their presence in a folder
//    lives in `message_locations` keyed by (mailbox_id, uid_validity, uid).

import { buildProvider } from "../email/build-provider";
import { AbortError } from "../email/imap";
import type { Env } from "../env";
import { newMailSince, notifyNewMail } from "../push/service";
import { reconcileMailboxLocations } from "./sync-reconciliation";
import {
  applyProviderMessages,
  classifyError,
  getAccount,
  getCredential,
  getMailbox,
  getSyncCursor,
  markAccountSyncFailed,
  markAccountSyncSucceeded,
  markMailboxSyncFailed,
  setAccountState,
  setSyncState,
  syncCursorUpsert,
  unseenForBox,
  upsertMailbox,
} from "./sync-persistence";

export interface SyncResult {
  mailboxesSynced: number;
  messagesSeen: number;
  /** True when the sync was stopped by its time budget before finishing. */
  timedOut?: boolean;
}

export interface MailboxSyncResult {
  seen: number;
}

/**
 * Discover an account's mailboxes and sync each one. Runs within a hard time
 * budget enforced by cooperative cancellation: the loop checks an AbortSignal
 * between provider round-trips, so a hung provider socket is cut off rather
 * than blocking the queue consumer indefinitely.
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
  let reset: boolean;
  try {
    result = await provider.syncMailbox(
      mailbox.provider_path,
      { sinceUid: cursor?.last_uid ?? 0, fetchLimit },
      opts.signal,
    );
    // A UIDVALIDITY change invalidates every UID we hold for this mailbox — the
    // same numeric UID could now refer to a different email. Fetch the
    // replacement set FIRST; the local folder is only mutated once we hold new
    // data, and the purge + imports + cursor advance land in one batch below,
    // so a failed re-fetch never destroys the current local state.
    const uidValidity = result.uidValidity ?? 0;
    reset = cursor?.uid_validity != null && cursor.uid_validity !== uidValidity;
    if (reset) {
      // sinceUid: 0 restarts at the newest page (same as a fresh first sync);
      // older mail is backfilled by the load-older path on scroll.
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

  // On a UIDVALIDITY reset the old locations are stale; drop them atomically
  // with the replacement imports and the (fresh) cursor.
  const extra: D1PreparedStatement[] = [];
  if (reset) {
    extra.push(
      env.DB.prepare(`DELETE FROM message_locations WHERE mailbox_id = ?`).bind(mailboxId),
    );
  }
  extra.push(
    syncCursorUpsert(
      env,
      account.id,
      mailbox.id,
      uidValidity,
      result.highestUid,
      result.total ?? null,
      now,
      reset,
    ),
  );

  // Watermark for new-mail push detection: any inbox location created at or
  // after this instant during this pass is mail that just arrived.
  const syncStart = new Date().toISOString();

  const seen = await applyProviderMessages(
    env,
    account.id,
    mailbox.id,
    uidValidity,
    result.messages,
    extra,
  );

  // Reconcile stale locations against the provider's current UID set (also
  // prunes the logical messages the reset/re-point may have orphaned).
  await reconcileMailboxLocations(env, mailbox.id, result.currentUids);

  // Refresh mailbox stats.
  await env.DB.prepare(`UPDATE mailboxes SET total_messages = ?, unseen_messages = ? WHERE id = ?`)
    .bind(result.total ?? null, await unseenForBox(env, mailbox.id), mailbox.id)
    .run();

  // Notify for mail that just arrived in the inbox on an incremental sync.
  // First syncs (no prior cursor) and UIDVALIDITY resets re-import history and
  // are never notified; the delivery ledger makes this idempotent.
  if (!reset && cursor?.last_uid != null) {
    const box = await env.DB.prepare(`SELECT role FROM mailboxes WHERE id = ?`)
      .bind(mailbox.id)
      .first<{ role: string | null }>();
    if (box?.role === "inbox") {
      await notifyNewMail(env, await newMailSince(env, mailbox.id, syncStart));
    }
  }

  return { seen };
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
