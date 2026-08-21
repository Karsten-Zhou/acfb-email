// Integration tests: exercise the Hono API through the Workers runtime with
// the local D1 binding (migrations applied in e2e/apply-migrations.ts).
import { env, exports } from "cloudflare:workers";
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";

async function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`http://localhost${path}`, init);
}

// Seed the local D1 with a known user.
beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO users (id, github_id, github_login, display_name, avatar_url) VALUES ('u1', 12345, 'alice', 'Alice', NULL)`,
  ).run();
  await env.DB.prepare(`INSERT INTO app_settings (user_id, data) VALUES ('u1', '{}')`).run();
});

describe("api routes", () => {
  it("health endpoint returns ok", async () => {
    const res = await api("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects /api/auth/me without a session", async () => {
    const res = await api("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated mutation (401 before CSRF)", async () => {
    // requireAuth runs before csrfGuard, so no-session -> 401.
    const res = await api("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("denies unauthenticated access to accounts list", async () => {
    const res = await api("/api/accounts");
    expect(res.status).toBe(401);
  });

  it("exposes dev secrets (allowlist + encryption key present)", () => {
    expect(env.ALLOWED_GITHUB_USER_ID).toBeTruthy();
    expect(env.CREDENTIAL_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
  });

  it("allows authenticated session to list empty accounts", async () => {
    // Create a session directly in D1 (simulates a completed OAuth callback).
    const sessionToken = "test-session-token-0001";
    const hashed = createHash("sha256").update(sessionToken).digest("hex");
    const expires = new Date(Date.now() + 60_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
    )
      .bind(hashed, "u1", expires)
      .run();

    const csrf = "csrf-test-0001";
    const me = await api("/api/auth/me", {
      headers: { Cookie: `ec_session=${sessionToken}` },
    });
    expect(me.status).toBe(200);

    const accounts = await api("/api/accounts", {
      headers: {
        Cookie: `ec_session=${sessionToken}; ec_csrf=${csrf}`,
        "x-csrf-token": csrf,
      },
    });
    expect(accounts.status).toBe(200);
    const body = (await accounts.json()) as { accounts: unknown[] };
    expect(body.accounts).toEqual([]);
  });
});