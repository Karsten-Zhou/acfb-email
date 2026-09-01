// Push routes: /api/push — browser push capability/subscription management.
// The VAPID public key is public (not a secret) but is only served to the app
// behind Cloudflare Access; the private key never leaves the Worker.
import { Hono } from "hono";
import { z } from "zod";
import { PushSubscriptionSchema } from "../../shared/schemas";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { cleanupInactiveSubscriptions } from "../push/service";
import {
  listPushSubscriptions,
  removePushSubscription,
  removePushSubscriptionByEndpoint,
  upsertPushSubscription,
} from "../push/subscriptions";
import { getVapidConfig } from "../push/vapid";

export const pushRoutes = new Hono<{ Bindings: Env }>();

const idSchema = z.string().uuid();
const removeByEndpointSchema = z.object({ endpoint: z.string().url().max(2048) });

function parseOr400<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, "Invalid request body", "invalid_input");
  return result.data;
}

// GET /api/push/capability — whether Web Push is configured, the VAPID public
// key, and the current subscription list (redacted).
pushRoutes.get("/capability", async (c) => {
  const vapid = getVapidConfig(c.env);
  const subscriptions = await listPushSubscriptions(c.env);
  return c.json({
    configured: vapid !== null,
    publicKey: vapid?.publicKey ?? null,
    subscriptions,
  });
});

// GET /api/push/key — the VAPID public key, required by pushManager.subscribe.
// Returns 409 when Web Push isn't configured.
pushRoutes.get("/key", async (c) => {
  const vapid = getVapidConfig(c.env);
  if (!vapid) throw new HttpError(409, "Push is not configured", "push_not_configured");
  return c.json({ publicKey: vapid.publicKey });
});

// PUT /api/push/subscription — create or update the current device's
// subscription. The app has no per-user model (Cloudflare Access gates it), so
// the endpoint itself identifies the device.
pushRoutes.put("/subscription", async (c) => {
  const input = parseOr400(PushSubscriptionSchema, await c.req.json());
  const { id } = await upsertPushSubscription(c.env, input);
  return c.json({ ok: true, id });
});

// DELETE /api/push/subscription/:id — remove a subscription.
pushRoutes.delete("/subscription/:id", async (c) => {
  const id = parseOr400(idSchema, c.req.param("id"));
  const removed = await removePushSubscription(c.env, id);
  if (removed === 0) throw new HttpError(404, "Subscription not found", "not_found");
  return c.json({ ok: true });
});

// POST /api/push/subscription/remove — remove by endpoint (used when the
// browser's subscription changed or was unsubscribed locally).
pushRoutes.post("/subscription/remove", async (c) => {
  const { endpoint } = parseOr400(removeByEndpointSchema, await c.req.json());
  await removePushSubscriptionByEndpoint(c.env, endpoint);
  return c.json({ ok: true });
});

// POST /api/push/cleanup — remove deactivated (dead) subscriptions.
pushRoutes.post("/cleanup", async (c) => {
  const removed = await cleanupInactiveSubscriptions(c.env);
  return c.json({ ok: true, removed });
});
