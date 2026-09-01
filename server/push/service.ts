// Web Push delivery for new mail. The sync engine passes genuinely-new inbox
// mail here; we build a compact payload, claim each message in the
// notification_deliveries ledger, and deliver it to every active subscription.
// The ledger (INSERT ... ON CONFLICT DO NOTHING) makes delivery idempotent, so
// a re-run sync can never re-notify the same mail.
import webpush from "web-push";
import type { Env } from "../env";
import { configureWebPush, getVapidConfig } from "./vapid";
import type { PushSubscriptionRow } from "./subscriptions";

/** Number of consecutive failures before a subscription is auto-deactivated. */
const MAX_FAILURES_BEFORE_DEACTIVATE = 3;

/** A genuinely-new message the sync engine decided should be notified. */
export interface NewMailNotification {
  messageId: string;
  accountId: string;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
}

/** The compact payload sent to the service worker (never message bodies). */
export interface PushNotificationPayload {
  type: "new-mail" | "revoke";
  title?: string;
  body?: string;
  tag: string;
  url?: string;
  messageId?: string;
  accountId?: string;
}

export function buildPayload(n: NewMailNotification): PushNotificationPayload {
  return {
    type: "new-mail",
    title: n.fromName || n.fromAddress || "New email",
    body: n.subject || "(no subject)",
    tag: `mail:${n.messageId}`,
    url: `/mail/message/${n.messageId}`,
    messageId: n.messageId,
    accountId: n.accountId,
  };
}

interface PushErrorLike {
  statusCode?: number;
}

function pushErrorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    return (err as PushErrorLike).statusCode;
  }
  return undefined;
}

/**
 * New messages whose inbox location was created during this sync pass — the
 * mail that just arrived in the folder. `sinceIso` is the sync-start
 * watermark captured before the pass ran.
 */
export async function newMailSince(
  env: Env,
  mailboxId: string,
  sinceIso: string,
): Promise<NewMailNotification[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.id AS messageId, m.account_id AS accountId, m.subject,
            m.from_name AS fromName, m.from_address AS fromAddress
     FROM message_locations ml
     JOIN messages m ON m.id = ml.message_id
     WHERE ml.mailbox_id = ? AND ml.created_at >= ?`,
  )
    .bind(mailboxId, sinceIso)
    .all<NewMailNotification>();
  return results;
}

/** Deliver to one subscription; "expired" means the endpoint is gone (404/410). */
async function sendToOne(
  sub: Pick<PushSubscriptionRow, "endpoint" | "p256dh" | "auth">,
  payload: PushNotificationPayload,
): Promise<"ok" | "expired" | "error"> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        contentEncoding: "aes128gcm",
        // 24h TTL: push services drop stale messages after this.
        TTL: 24 * 60 * 60,
        urgency: "high",
      },
    );
    return "ok";
  } catch (err) {
    const status = pushErrorStatus(err);
    if (status === 404 || status === 410) return "expired";
    return "error";
  }
}

async function recordFailure(env: Env, id: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT enabled, failure_count FROM push_subscriptions WHERE id = ?`,
  )
    .bind(id)
    .first<{ enabled: number; failure_count: number }>();
  if (!row) return;
  const failureCount = row.failure_count + 1;
  await env.DB.prepare(
    `UPDATE push_subscriptions
     SET failure_count = ?, last_failure_at = ?,
         enabled = CASE WHEN ? >= ${MAX_FAILURES_BEFORE_DEACTIVATE} THEN 0 ELSE enabled END
     WHERE id = ?`,
  )
    .bind(failureCount, new Date().toISOString(), failureCount, id)
    .run();
}

/**
 * Deliver new-mail notifications. Quietly no-ops when Web Push is unconfigured
 * (no VAPID keys, e.g. local dev) or there are no active subscriptions, so the
 * sync pipeline is never failed by push. Returns the number of messages
 * delivered.
 */
export async function notifyNewMail(env: Env, messages: NewMailNotification[]): Promise<number> {
  if (messages.length === 0) return 0;
  if (!getVapidConfig(env)) return 0;
  configureWebPush(env);

  const subs = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth, enabled, failure_count FROM push_subscriptions WHERE enabled = 1`,
  ).all<PushSubscriptionRow>();
  if (subs.results.length === 0) return 0;

  let delivered = 0;
  for (const n of messages) {
    // Claim the idempotency row; a conflict means we've already notified.
    const claim = await env.DB.prepare(
      `INSERT INTO notification_deliveries (message_id) VALUES (?) ON CONFLICT(message_id) DO NOTHING`,
    )
      .bind(n.messageId)
      .run();
    if (claim.meta.changes === 0) continue;

    const payload = buildPayload(n);
    for (const sub of subs.results) {
      const outcome = await sendToOne(sub, payload);
      if (outcome === "ok") {
        delivered += 1;
        await env.DB.prepare(
          `UPDATE push_subscriptions SET failure_count = 0, last_delivered_at = ? WHERE id = ?`,
        )
          .bind(new Date().toISOString(), sub.id)
          .run();
      } else if (outcome === "expired") {
        // The push service reports the endpoint is gone — deactivate it and
        // keep delivering to the remaining subscriptions.
        await env.DB.prepare(
          `UPDATE push_subscriptions SET enabled = 0, failure_count = 0 WHERE id = ?`,
        )
          .bind(sub.id)
          .run();
      } else {
        await recordFailure(env, sub.id);
      }
    }

    await env.DB.prepare(
      `UPDATE notification_deliveries SET status = 'sent', delivered_at = ? WHERE message_id = ?`,
    )
      .bind(new Date().toISOString(), n.messageId)
      .run();
  }
  return delivered;
}

/** Remove deactivated (dead) subscriptions. Returns count removed. */
export async function cleanupInactiveSubscriptions(env: Env): Promise<number> {
  const res = await env.DB.prepare(`DELETE FROM push_subscriptions WHERE enabled = 0`).run();
  return res.meta.changes;
}

/**
 * Dismiss a delivered notification on every device once the message is read
 * on any one of them (cross-device sync). Only messages with a recorded
 * delivery are revoked. Best-effort: no-op when push is unconfigured or there
 * are no active subscriptions. The service worker closes notifications whose
 * `tag` matches the payload.
 */
export async function revokeNotifications(env: Env, messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  if (!getVapidConfig(env)) return 0;
  configureWebPush(env);

  // Only revoke messages we actually notified about.
  const ph = messageIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT message_id FROM notification_deliveries WHERE message_id IN (${ph}) AND status = 'sent'`,
  )
    .bind(...messageIds)
    .all<{ message_id: string }>();
  if (results.length === 0) return 0;

  const subs = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth, enabled, failure_count FROM push_subscriptions WHERE enabled = 1`,
  ).all<PushSubscriptionRow>();
  if (subs.results.length === 0) return 0;

  let sent = 0;
  for (const r of results) {
    const payload: PushNotificationPayload = {
      type: "revoke",
      tag: `mail:${r.message_id}`,
    };
    for (const sub of subs.results) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { contentEncoding: "aes128gcm", TTL: 60, urgency: "normal" },
        );
        sent += 1;
      } catch {
        // A dead endpoint here is harmless; the next delivery pass cleans it up.
      }
    }
  }
  return sent;
}
