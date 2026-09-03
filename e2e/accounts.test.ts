// Account routes: /api/accounts (non-network paths)
//
// POST /api/accounts and POST /api/accounts/test attempt a real IMAP
// connection (`ImapProvider.testConnection()`), which the workerd test runtime
// cannot satisfy — those are covered by unit tests, not here.
import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { apiJson, clearDb, seedAccount } from "./helpers";

interface ApiAccountSummary {
  id: string;
  provider: string;
  name: string;
  email: string;
  displayName: string | null;
  state: string;
  stateMessage: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
  sortOrder: number;
}

interface ApiAccountDetail extends ApiAccountSummary {
  imapHost: string | null;
  imapPort: number | null;
  smtpHost: string | null;
  smtpPort: number | null;
  useTls: boolean | null;
  syncEnabled: boolean;
}

interface StateRow {
  id: string;
  state: string;
  stateMessage: string | null;
  lastSyncedAt: string | null;
}

describe("accounts routes", () => {
  beforeEach(() => clearDb(env));

  it("returns an empty list when no accounts exist", async () => {
    const { status, body } = await apiJson<{ accounts: ApiAccountSummary[] }>("/api/accounts");
    expect(status).toBe(200);
    expect(body.accounts).toEqual([]);
  });

  it("lists accounts in sort order with summary fields", async () => {
    await seedAccount(env, { id: "acct-b", name: "Beta", sortOrder: 2, email: "b@example.com" });
    await seedAccount(env, { id: "acct-a", name: "Alpha", sortOrder: 1, email: "a@example.com" });

    const { status, body } = await apiJson<{ accounts: ApiAccountSummary[] }>("/api/accounts");
    expect(status).toBe(200);
    expect(body.accounts.map((a) => a.id)).toEqual(["acct-a", "acct-b"]);
    const first = body.accounts[0];
    expect(first).toMatchObject({
      id: "acct-a",
      provider: "imap",
      name: "Alpha",
      email: "a@example.com",
      displayName: null,
      state: "healthy",
      stateMessage: null,
      sortOrder: 1,
    });
    expect(typeof first.createdAt).toBe("string");
    expect(first.lastSyncedAt).toBeNull();
  });

  it("returns lightweight state rows", async () => {
    await seedAccount(env, { id: "acct-x", state: "running", syncEnabled: 1 });

    const { status, body } = await apiJson<{ accounts: StateRow[] }>("/api/accounts/states");
    expect(status).toBe(200);
    expect(body.accounts).toEqual([
      { id: "acct-x", state: "running", stateMessage: null, lastSyncedAt: null },
    ]);
  });

  it("GET /:id returns account detail", async () => {
    await seedAccount(env, { id: "acct-det", name: "Detail", email: "d@example.com" });

    const { status, body } = await apiJson<{ account: ApiAccountDetail }>("/api/accounts/acct-det");
    expect(status).toBe(200);
    expect(body.account).toMatchObject({
      id: "acct-det",
      name: "Detail",
      email: "d@example.com",
      displayName: null,
      provider: "imap",
      state: "healthy",
      syncEnabled: true,
      imapHost: null,
      imapPort: null,
      smtpHost: null,
      smtpPort: null,
      useTls: true,
    });
  });

  it("GET /:id returns 404 for an unknown account", async () => {
    const { status } = await apiJson("/api/accounts/nope");
    expect(status).toBe(404);
  });

  it("PATCH updates the account name and sync enabled", async () => {
    await seedAccount(env, { id: "acct-upd", name: "Before" });

    const patch = await apiJson("/api/accounts/acct-upd", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "After", syncEnabled: false }),
    });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ ok: true });

    const { body } = await apiJson<{ account: ApiAccountDetail }>("/api/accounts/acct-upd");
    expect(body.account.name).toBe("After");
    expect(body.account.syncEnabled).toBe(false);
  });

  it("PATCH with an empty body is a no-op success", async () => {
    await seedAccount(env, { id: "acct-noop" });

    const res = await apiJson("/api/accounts/acct-noop", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("PUT /order sets display order by array index", async () => {
    await seedAccount(env, { id: "acct-1" });
    await seedAccount(env, { id: "acct-2" });

    const res = await apiJson("/api/accounts/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedIds: ["acct-2", "acct-1"] }),
    });
    expect(res.status).toBe(200);

    const { body } = await apiJson<{ accounts: ApiAccountSummary[] }>("/api/accounts");
    expect(body.accounts.map((a) => a.id)).toEqual(["acct-2", "acct-1"]);
  });

  it("DELETE removes the account", async () => {
    await seedAccount(env, { id: "acct-del" });

    const del = await apiJson("/api/accounts/acct-del", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });

    const { body } = await apiJson<{ accounts: ApiAccountSummary[] }>("/api/accounts");
    expect(body.accounts).toEqual([]);
  });
});
