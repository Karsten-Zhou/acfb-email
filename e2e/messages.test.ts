// Message routes: /api/messages (read paths only)
//
// The list, unified, and body-fetched detail routes succeed against a seeded
// D1 DB with no network. Routes that open a real IMAP connection (flags /
// move / delete, and detail with body_fetched = 0) are network-bound and are
// covered by unit tests, not here.
import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { apiJson, clearDb, seedAccount, seedMailbox, seedMessage } from "./helpers";

interface ApiRecipient {
  name: string | null;
  address: string;
}

interface ApiMessage {
  id: string;
  accountId: string;
  mailboxId: string;
  remoteUid: number | null;
  subject: string | null;
  snippet: string | null;
  from: ApiRecipient | null;
  date: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  maybeThreadId: string | null;
}

interface ApiMessageDetail extends ApiMessage {
  html: string | null;
  text: string | null;
  attachments: unknown[];
}

describe("messages routes", () => {
  beforeEach(() => clearDb(env));

  it("lists a mailbox's messages newest-first with full fields", async () => {
    await seedAccount(env, { id: "acct-list" });
    await seedMailbox(env, { id: "mb-list", accountId: "acct-list", role: "inbox" });
    await seedMessage(env, {
      id: "msg-old",
      accountId: "acct-list",
      mailboxId: "mb-list",
      uid: 2,
      subject: "Older",
      fromName: "Old Sender",
      fromAddress: "old@example.com",
      receivedAt: "2026-09-01T10:00:00Z",
      isRead: 1,
      isStarred: 1,
    });
    await seedMessage(env, {
      id: "msg-new",
      accountId: "acct-list",
      mailboxId: "mb-list",
      uid: 7,
      subject: "Newer",
      fromName: "New Sender",
      fromAddress: "new@example.com",
      receivedAt: "2026-09-03T10:00:00Z",
    });

    const { status, body } = await apiJson<{ messages: ApiMessage[]; hasMore: boolean }>(
      "/api/messages?mailboxId=mb-list&limit=50&offset=0",
    );
    expect(status).toBe(200);
    expect(body.hasMore).toBe(false);
    expect(body.messages.map((m) => m.id)).toEqual(["msg-new", "msg-old"]);

    const newest = body.messages[0];
    expect(newest).toMatchObject({
      id: "msg-new",
      accountId: "acct-list",
      mailboxId: "mb-list",
      remoteUid: 7,
      subject: "Newer",
      from: { name: "New Sender", address: "new@example.com" },
      receivedAt: "2026-09-03T10:00:00Z",
      date: "2026-09-03T10:00:00Z",
      isRead: false,
      isStarred: false,
    });
    expect(newest.snippet).toBeNull();
  });

  it("returns 400 when mailboxId is missing", async () => {
    const { status, body } = await apiJson<{ error?: unknown; code?: unknown }>("/api/messages");
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(typeof body.code).toBe("string");
  });

  it("returns 404 for an unknown mailboxId", async () => {
    const { status } = await apiJson("/api/messages?mailboxId=does-not-exist");
    expect(status).toBe(404);
  });

  it("clamps limit to 100 messages", async () => {
    await seedAccount(env, { id: "acct-cap" });
    await seedMailbox(env, { id: "mb-cap", accountId: "acct-cap", role: "inbox" });
    for (let i = 0; i < 105; i++) {
      await seedMessage(env, {
        id: `cap-${i}`,
        accountId: "acct-cap",
        mailboxId: "mb-cap",
        uid: i,
        receivedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
      });
    }

    const { status, body } = await apiJson<{ messages: ApiMessage[]; hasMore: boolean }>(
      "/api/messages?mailboxId=mb-cap&limit=1000&offset=0",
    );
    expect(status).toBe(200);
    expect(body.messages.length).toBe(100);
    expect(body.hasMore).toBe(true);
  });

  it("returns the unified inbox across mailboxes with dedup", async () => {
    await seedAccount(env, { id: "acct-u" });
    await seedMailbox(env, { id: "mb-a", accountId: "acct-u", role: "inbox", name: "Inbox A" });
    await seedMailbox(env, { id: "mb-b", accountId: "acct-u", role: "inbox", name: "Inbox B" });
    await seedMessage(env, {
      id: "m-a",
      accountId: "acct-u",
      mailboxId: "mb-a",
      uid: 1,
      receivedAt: "2026-09-03T10:00:00Z",
    });
    await seedMessage(env, {
      id: "m-b",
      accountId: "acct-u",
      mailboxId: "mb-b",
      uid: 1,
      receivedAt: "2026-09-01T10:00:00Z",
    });
    // The same logical message present in two mailboxes (Inbox + All Mail).
    await seedMessage(env, {
      id: "shared",
      accountId: "acct-u",
      mailboxId: "mb-a",
      uid: 2,
      receivedAt: "2026-09-02T10:00:00Z",
    });
    await env.DB.prepare(
      `INSERT INTO message_locations (id, message_id, mailbox_id, uid, uid_validity, is_read, is_starred)
       VALUES (?, ?, ?, ?, 1, 0, 0)`,
    )
      .bind("shared-loc-b", "shared", "mb-b", 2)
      .run();

    const { status, body } = await apiJson<{ messages: ApiMessage[]; hasMore: boolean }>(
      "/api/messages/unified?limit=50&offset=0",
    );
    expect(status).toBe(200);
    expect(body.hasMore).toBe(false);
    expect(body.messages.map((m) => m.id)).toEqual(["m-a", "shared", "m-b"]);
    // GROUP BY the logical message: shared appears exactly once.
    expect(body.messages.filter((m) => m.id === "shared").length).toBe(1);
  });

  it("returns a detail when the body is already fetched", async () => {
    await seedAccount(env, { id: "acct-det" });
    await seedMailbox(env, { id: "mb-det", accountId: "acct-det", role: "inbox" });
    await seedMessage(env, {
      id: "msg-det",
      accountId: "acct-det",
      mailboxId: "mb-det",
      uid: 5,
      subject: "Detail",
      bodyFetched: 1,
      htmlPreview: "<p>hi</p>",
      textPreview: "hi",
    });

    const { status, body } = await apiJson<{ message: ApiMessageDetail }>(
      "/api/messages/msg-det?mailboxId=mb-det",
    );
    expect(status).toBe(200);
    expect(body.message).toMatchObject({
      id: "msg-det",
      mailboxId: "mb-det",
      subject: "Detail",
      remoteUid: 5,
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(body.message.attachments).toEqual([]);
  });

  it("returns 404 for an unknown message id", async () => {
    const { status } = await apiJson("/api/messages/nope?mailboxId=anything");
    expect(status).toBe(404);
  });
});
