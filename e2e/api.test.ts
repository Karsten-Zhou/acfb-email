// Core smoke tests: the API gate, the health endpoint, and dev-secret wiring.
// Per-route coverage lives in the sibling files (accounts/mailboxes/messages/
// settings/push); each group is isolated via `clearDb()` in `beforeEach`.
import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { api, clearDb } from "./helpers";

describe("api gate", () => {
  beforeEach(() => clearDb(env));

  it("health endpoint returns ok", async () => {
    const res = await api("/api/health", {
      headers: { "cf-access-jwt-assertion": "test-access-jwt" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("refuses requests with no Cloudflare Access evidence (403)", async () => {
    const res = await api("/api/health");
    expect(res.status).toBe(403);
  });

  it("exposes dev secrets (encryption key present)", () => {
    expect(env.CREDENTIAL_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 404 for unknown api paths", async () => {
    const res = await api("/api/does-not-exist", {
      headers: { "cf-access-jwt-assertion": "test-access-jwt" },
    });
    expect(res.status).toBe(404);
  });
});
