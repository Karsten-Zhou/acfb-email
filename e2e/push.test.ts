// Push routes: /api/push — capability + subscription management (pure D1).
//
// Real Web Push delivery is not testable in workerd (no network). Whether VAPID
// is configured depends on `.env` (auto-loaded into the worker), so capability
// assertions are kept shape-based rather than pinned to a configured value.
// Only the D1-backed subscription lifecycle is exercised here.
import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { apiJson, clearDb } from "./helpers";

interface ApiSubscription {
  id: string;
  endpoint: string;
  enabled: number;
  created_at: string;
}

interface CapabilityBody {
  configured: boolean;
  publicKey: string | null;
  subscriptions: ApiSubscription[];
}

interface ErrBody {
  error?: unknown;
  code?: unknown;
}

const ENDPOINT_A = "https://fcm.googleapis.com/fcm/send/device-a";
const ENDPOINT_B = "https://fcm.googleapis.com/fcm/send/device-b";

/** Insert a push_subscriptions row directly (endpoint/keys are redacted server-side). */
async function seedSubscription(
  id: string,
  endpoint: string,
  keys: { p256dh: string; auth: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, endpoint, keys.p256dh, keys.auth)
    .run();
}

const validKeys = (suffix: string) => ({ p256dh: `p256dh-${suffix}`, auth: `auth-${suffix}` });

describe("push routes", () => {
  beforeEach(() => clearDb(env));

  it("GET /capability returns the capability shape with an empty list", async () => {
    const { status, body } = await apiJson<CapabilityBody>("/api/push/capability");
    expect(status).toBe(200);
    expect(typeof body.configured).toBe("boolean");
    expect(body.publicKey === null || typeof body.publicKey === "string").toBe(true);
    expect(body.subscriptions).toEqual([]);
  });

  it("GET /capability lists subscriptions redacted", async () => {
    await seedSubscription("11111111-1111-4111-8111-111111111111", ENDPOINT_A, validKeys("a"));
    await seedSubscription("22222222-2222-4222-8222-222222222222", ENDPOINT_B, validKeys("b"));

    const { status, body } = await apiJson<CapabilityBody>("/api/push/capability");
    expect(status).toBe(200);
    expect(typeof body.configured).toBe("boolean");
    expect(body.subscriptions).toHaveLength(2);
    const ids = body.subscriptions.map((s) => s.id);
    expect(ids).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    for (const s of body.subscriptions) {
      expect(s).toMatchObject({
        endpoint: expect.any(String),
        enabled: 1,
        created_at: expect.any(String),
      });
      expect(JSON.stringify(s)).not.toContain("p256dh");
      expect(JSON.stringify(s)).not.toContain("auth-");
    }
  });

  it("PUT /subscription upserts by endpoint", async () => {
    const first = await apiJson<{ ok: boolean; id: string }>("/api/push/subscription", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: ENDPOINT_A, keys: validKeys("a") }),
    });
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Same endpoint with new keys must update the same row, not duplicate.
    const second = await apiJson<{ ok: boolean; id: string }>("/api/push/subscription", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: ENDPOINT_A, keys: validKeys("a2") }),
    });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const { body } = await apiJson<CapabilityBody>("/api/push/capability");
    expect(body.subscriptions).toHaveLength(1);
    expect(body.subscriptions[0].id).toBe(first.body.id);
  });

  it("PUT /subscription returns 400 for an invalid body", async () => {
    // endpoint is not a URL.
    const notUrl = await apiJson<ErrBody>("/api/push/subscription", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: "not-a-url", keys: validKeys("a") }),
    });
    expect(notUrl.status).toBe(400);
    expect(typeof notUrl.body.error).toBe("string");

    // missing keys.
    const missingKeys = await apiJson<ErrBody>("/api/push/subscription", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: ENDPOINT_A }),
    });
    expect(missingKeys.status).toBe(400);
    expect(typeof missingKeys.body.error).toBe("string");
  });

  it("DELETE /subscription/:id removes a seeded subscription", async () => {
    await seedSubscription("11111111-1111-4111-8111-111111111111", ENDPOINT_A, validKeys("a"));

    const del = await apiJson<{ ok: boolean }>(
      "/api/push/subscription/11111111-1111-4111-8111-111111111111",
      { method: "DELETE" },
    );
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });

    const { body } = await apiJson<CapabilityBody>("/api/push/capability");
    expect(body.subscriptions).toEqual([]);
  });

  it("DELETE /subscription/:id returns 404 for an unknown uuid", async () => {
    const { status } = await apiJson<ErrBody>(
      "/api/push/subscription/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { method: "DELETE" },
    );
    expect(status).toBe(404);
  });

  it("DELETE /subscription/:id returns 400 for a non-uuid id", async () => {
    const { status, body } = await apiJson<ErrBody>("/api/push/subscription/abc", {
      method: "DELETE",
    });
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(typeof body.code).toBe("string");
  });

  it("POST /subscription/remove removes by endpoint", async () => {
    await seedSubscription("11111111-1111-4111-8111-111111111111", ENDPOINT_A, validKeys("a"));

    const remove = await apiJson<{ ok: boolean }>("/api/push/subscription/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: ENDPOINT_A }),
    });
    expect(remove.status).toBe(200);
    expect(remove.body).toEqual({ ok: true });

    const { body } = await apiJson<CapabilityBody>("/api/push/capability");
    expect(body.subscriptions).toEqual([]);
  });

  it("POST /subscription/remove is idempotent for a missing endpoint", async () => {
    const remove = await apiJson<{ ok: boolean }>("/api/push/subscription/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: ENDPOINT_A }),
    });
    expect(remove.status).toBe(200);
    expect(remove.body).toEqual({ ok: true });
  });

  it("POST /cleanup on an empty table removes nothing", async () => {
    const { status, body } = await apiJson<{ ok: boolean; removed: number }>("/api/push/cleanup", {
      method: "POST",
    });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, removed: 0 });
  });
});
