// D1 persistence for browser push subscriptions. The app is single-user behind
// Cloudflare Access (no per-user model), so subscriptions are global: any
// active subscription receives new-mail notifications. `account_id` stays NULL
// and the endpoint uniquely identifies a device (UNIQUE(endpoint)).
import { randomUUID } from "crypto";

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: number;
  failure_count: number;
  created_at: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

/**
 * Upsert a browser PushSubscription. The endpoint uniquely identifies a
 * device, so re-subscribing the same one updates its row (and re-activates it)
 * rather than creating a duplicate.
 */
export async function upsertPushSubscription(
  env: Env,
  input: PushSubscriptionInput,
): Promise<{ id: string }> {
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, enabled, failure_count)
     VALUES (?, ?, ?, ?, 1, 0)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       enabled = 1,
       failure_count = 0`,
  )
    .bind(randomUUID(), input.endpoint, input.keys.p256dh, input.keys.auth)
    .run();
  const row = await env.DB.prepare(`SELECT id FROM push_subscriptions WHERE endpoint = ?`)
    .bind(input.endpoint)
    .first<{ id: string }>();
  return { id: row!.id };
}

/** List push subscriptions (redacted — no auth/keys). */
export async function listPushSubscriptions(
  env: Env,
): Promise<Array<{ id: string; endpoint: string; enabled: number; created_at: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT id, endpoint, enabled, created_at FROM push_subscriptions ORDER BY created_at`,
  ).all<{ id: string; endpoint: string; enabled: number; created_at: string }>();
  return results;
}

/** Remove a push subscription by id. Returns rows removed (0 if none). */
export async function removePushSubscription(env: Env, id: string): Promise<number> {
  const res = await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(id).run();
  return res.meta.changes;
}

/** Remove a push subscription by endpoint (used on local unsubscribe). */
export async function removePushSubscriptionByEndpoint(
  env: Env,
  endpoint: string,
): Promise<number> {
  const res = await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`)
    .bind(endpoint)
    .run();
  return res.meta.changes;
}
