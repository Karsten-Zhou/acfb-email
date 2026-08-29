// Reconciliation: after a mailbox sync, drop locations whose provider UID is no
// longer present and prune logical messages that no longer have any location.

import type { Env } from "../env";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Reconcile a mailbox's local locations against the provider's authoritative
 * UID set (`currentUids` — the complete set currently in the folder). A
 * location whose UID is no longer present belongs to a message that moved away
 * or was deleted, so it is removed. A message that legitimately lives in
 * several folders (e.g. a self-sent mail appears in Inbox AND Sent) is
 * untouched, because its UID is present in each folder's set. Orphaned logical
 * messages (no remaining location anywhere) are always pruned. Returns the
 * number of locations removed.
 */
export async function reconcileMailboxLocations(
  env: Env,
  mailboxId: string,
  currentUids: number[],
): Promise<number> {
  const local = await env.DB.prepare(`SELECT id, uid FROM message_locations WHERE mailbox_id = ?`)
    .bind(mailboxId)
    .all<{ id: string; uid: number }>();

  const present = new Set(currentUids);
  const stale = local.results.filter((row) => !present.has(row.uid));

  let removed = 0;
  for (const ids of chunk(
    stale.map((r) => r.id),
    500,
  )) {
    if (ids.length === 0) continue;
    const ph = ids.map(() => "?").join(",");
    const r = await env.DB.prepare(`DELETE FROM message_locations WHERE id IN (${ph})`)
      .bind(...ids)
      .run();
    removed += r.meta.changes ?? 0;
  }

  // Always prune: a location can be re-pointed to a new logical message when a
  // provider changes a Message-ID, orphaning the previous one.
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
