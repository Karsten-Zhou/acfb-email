// Mailbox routes: /api/mailboxes
import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { apiJson, clearDb, seedAccount, seedMailbox } from "./helpers";

interface ApiMailbox {
  id: string;
  accountId: string;
  name: string;
  role: string;
  providerPath: string | null;
  delimiter: string | null;
  totalMessages: number | null;
  unseenMessages: number | null;
}

describe("mailboxes routes", () => {
  beforeEach(() => clearDb(env));

  it("returns 400 when accountId is missing", async () => {
    const { status, body } = await apiJson<{ error?: unknown; code?: unknown }>("/api/mailboxes");
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(typeof body.code).toBe("string");
  });

  it("returns an empty list for an account with no mailboxes", async () => {
    await seedAccount(env, { id: "acct-empty" });
    const { status, body } = await apiJson<{ mailboxes: ApiMailbox[] }>(
      "/api/mailboxes?accountId=acct-empty",
    );
    expect(status).toBe(200);
    expect(body.mailboxes).toEqual([]);
  });

  it("returns only the requested account's mailboxes in sort order", async () => {
    await seedAccount(env, { id: "acct-a" });
    await seedAccount(env, { id: "acct-b" });
    await seedMailbox(env, { id: "mb-a1", accountId: "acct-a", name: "Alpha", sortOrder: 10 });
    await seedMailbox(env, { id: "mb-a2", accountId: "acct-a", name: "Beta", sortOrder: 20 });
    await seedMailbox(env, { id: "mb-b1", accountId: "acct-b", name: "Gamma", sortOrder: 5 });

    const { body } = await apiJson<{ mailboxes: ApiMailbox[] }>("/api/mailboxes?accountId=acct-a");
    expect(body.mailboxes.map((m) => m.id)).toEqual(["mb-a1", "mb-a2"]);
  });

  it("maps DB columns to the API shape", async () => {
    await seedAccount(env, { id: "acct-map" });
    await seedMailbox(env, {
      id: "mb-map",
      accountId: "acct-map",
      name: "Archive",
      role: "archive",
      providerPath: "INBOX.Archive",
      totalMessages: 42,
      unseenMessages: 7,
      sortOrder: 1,
    });

    const { body } = await apiJson<{ mailboxes: ApiMailbox[] }>(
      "/api/mailboxes?accountId=acct-map",
    );
    expect(body.mailboxes).toEqual([
      {
        id: "mb-map",
        accountId: "acct-map",
        name: "Archive",
        role: "archive",
        providerPath: "INBOX.Archive",
        delimiter: null,
        totalMessages: 42,
        unseenMessages: 7,
      },
    ]);
  });

  it("orders by sort_order ascending", async () => {
    await seedAccount(env, { id: "acct-order" });
    await seedMailbox(env, { id: "mb-late", accountId: "acct-order", name: "Late", sortOrder: 20 });
    await seedMailbox(env, {
      id: "mb-early",
      accountId: "acct-order",
      name: "Early",
      sortOrder: 10,
    });

    const { body } = await apiJson<{ mailboxes: ApiMailbox[] }>(
      "/api/mailboxes?accountId=acct-order",
    );
    expect(body.mailboxes.map((m) => m.id)).toEqual(["mb-early", "mb-late"]);
  });

  it("returns an empty list (200) for an unknown account id", async () => {
    const { status, body } = await apiJson<{ mailboxes: ApiMailbox[] }>(
      "/api/mailboxes?accountId=does-not-exist",
    );
    expect(status).toBe(200);
    expect(body.mailboxes).toEqual([]);
  });
});
