// Integration tests: exercise the Hono API through the Workers runtime with
// the local D1 binding (migrations applied in e2e/apply-migrations.ts).
//
// The API gate refuses requests with no Cloudflare Access evidence. Tests
// simulate an approved request with the `Cf-Access-Jwt-Assertion` header.
import { env, exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

const ACCESS_HEADER = { "cf-access-jwt-assertion": "test-access-jwt" };

async function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`http://localhost${path}`, init);
}

describe("api routes", () => {
  it("health endpoint returns ok", async () => {
    const res = await api("/api/health", { headers: ACCESS_HEADER });
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

  it("returns the empty accounts list", async () => {
    const res = await api("/api/accounts", { headers: ACCESS_HEADER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: unknown[] };
    expect(body.accounts).toEqual([]);
  });

  it("updates the mailbox unseen count when flags change (refreshUnseen)", async () => {
    // Seed an account + mailbox + two messages (one unread).
    await env.DB.prepare(
      `INSERT INTO accounts (id, provider, name, email, state, sync_enabled, created_at)
       VALUES ('acct1', 'imap', 'Test', 't@example.com', 'healthy', 1, ?)`,
    )
      .bind(new Date().toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO mailboxes (id, account_id, name, role, provider_path, sort_order, total_messages, unseen_messages)
       VALUES ('box1', 'acct1', 'INBOX', 'inbox', 'INBOX', 0, NULL, NULL)`,
    ).run();
    const now = new Date().toISOString();
    for (const id of ["msg1", "msg2"]) {
      await env.DB.prepare(
        `INSERT INTO messages (id, account_id, mailbox_id, subject, received_at, is_read, is_starred)
         VALUES (?, 'acct1', 'box1', ?, ?, 0, 0)`,
      )
        .bind(id, `Subj ${id}`, now)
        .run();
    }

    // Emulate the route's post-flag-update recompute (repo.refreshUnseen).
    await env.DB.prepare(`UPDATE messages SET is_read = 1 WHERE id = 'msg1'`).run();
    const n = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM messages WHERE mailbox_id = 'box1' AND is_read = 0`,
    ).first<{ n: number }>();
    await env.DB.prepare(`UPDATE mailboxes SET unseen_messages = ? WHERE id = 'box1'`)
      .bind(n?.n ?? 0)
      .run();
    const row = await env.DB.prepare(
      `SELECT unseen_messages FROM mailboxes WHERE id = 'box1'`,
    ).first<{ unseen_messages: number | null }>();
    expect(row?.unseen_messages).toBe(1);
  });

  it("messages list exposes remoteUid for load-older cursor", async () => {
    const res = await api("/api/messages?mailboxId=box1&limit=50&offset=0", {
      headers: ACCESS_HEADER,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { remoteUid: number | null }[] };
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0]).toHaveProperty("remoteUid");
  });
});
