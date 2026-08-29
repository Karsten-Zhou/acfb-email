// Unit tests for the sync reconciliation primitives.
//
// The sync models a message's presence in a mailbox as a message_locations row
// keyed by (mailbox_id, uid_validity, uid). Reconcile drops locations whose UID
// is no longer in the provider's set (moved away or deleted) and prunes the
// now-orphaned logical messages. A self-sent mail genuinely lives in Inbox AND
// Sent at once, so both locations survive because each folder's UID set still
// contains the message.
import { describe, it, expect, beforeEach } from "vitest";
import { env as testEnv } from "cloudflare:workers";
import type { Env } from "../env";
import { reconcileMailboxLocations, logicalMessageId } from "./sync-service";
import type { ProviderMessage } from "../email/types";

// The test binding is a real D1 database, but its type is the generic
// Cloudflare.Env — cast to the app's Env so env.DB type-checks.
const env = testEnv as unknown as Env;

const ACCOUNT = "acct-1";

async function seedLocation(
  mailboxId: string,
  messageId: string,
  uid: number,
  uidValidity = 1,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO messages (id, account_id, subject, received_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(messageId, ACCOUNT, `Subj ${messageId}`, "2026-01-01T00:00:00.000Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO message_locations (id, message_id, mailbox_id, uid, uid_validity, is_read, is_starred)
     VALUES (?, ?, ?, ?, ?, 0, 0)`,
  )
    .bind(`${messageId}@${mailboxId}`, messageId, mailboxId, uid, uidValidity)
    .run();
}

async function uidsIn(mailboxId: string): Promise<number[]> {
  const r = await env.DB.prepare(`SELECT uid FROM message_locations WHERE mailbox_id = ?`)
    .bind(mailboxId)
    .all<{ uid: number }>();
  return r.results.map((x) => x.uid).sort((a, b) => a - b);
}

async function messagesWithNoLocations(): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE NOT EXISTS (SELECT 1 FROM message_locations ml WHERE ml.message_id = messages.id)`,
  ).first<{ n: number }>();
  return r?.n ?? 0;
}

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM message_locations`).run();
  await env.DB.prepare(`DELETE FROM messages`).run();
  await env.DB.prepare(`DELETE FROM mailboxes`).run();
  await env.DB.prepare(`DELETE FROM accounts`).run();
  await env.DB.prepare(
    `INSERT INTO accounts (id, provider, name, email) VALUES (?, 'imap', 'Test', 'a@b.c')`,
  )
    .bind(ACCOUNT)
    .run();
  const boxes = [
    ["inbox", "INBOX", "inbox"],
    ["sent", "Sent", "sent"],
  ] as const;
  for (const [id, name, role] of boxes) {
    await env.DB.prepare(
      `INSERT INTO mailboxes (id, account_id, name, role, provider_path) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, ACCOUNT, name, role, name)
      .run();
  }
});

describe("reconcileMailboxLocations", () => {
  it("keeps locations whose UID is still present in the folder", async () => {
    await seedLocation("inbox", "m1", 100);
    await seedLocation("inbox", "m2", 200);
    await reconcileMailboxLocations(env, "inbox", [100, 200]);
    expect(await uidsIn("inbox")).toEqual([100, 200]);
    expect(await messagesWithNoLocations()).toBe(0);
  });

  it("deletes locations whose UID is gone and prunes the orphaned message", async () => {
    await seedLocation("inbox", "m1", 100);
    await seedLocation("inbox", "m2", 200);
    await reconcileMailboxLocations(env, "inbox", [200]);
    expect(await uidsIn("inbox")).toEqual([200]);
    // m1 lost its only location and must be removed.
    expect(await messagesWithNoLocations()).toBe(0);
    const m1 = await env.DB.prepare(`SELECT id FROM messages WHERE id = 'm1'`).first();
    expect(m1).toBeNull();
  });

  it("keeps both copies of a self-sent message (present in Inbox AND Sent)", async () => {
    // A self-sent mail shares ONE logical message with a location in each box.
    await seedLocation("inbox", "self", 700);
    await env.DB.prepare(
      `INSERT INTO message_locations (id, message_id, mailbox_id, uid, uid_validity, is_read, is_starred)
       VALUES ('self@sent', 'self', 'sent', 200, 1, 0, 0)`,
    ).run();
    await reconcileMailboxLocations(env, "inbox", [700]);
    await reconcileMailboxLocations(env, "sent", [200]);
    expect(await uidsIn("inbox")).toEqual([700]);
    expect(await uidsIn("sent")).toEqual([200]);
    expect(await messagesWithNoLocations()).toBe(0);
  });

  it("does not prune a message that still has a location in another mailbox", async () => {
    await seedLocation("inbox", "m1", 100);
    await env.DB.prepare(
      `INSERT INTO message_locations (id, message_id, mailbox_id, uid, uid_validity, is_read, is_starred)
       VALUES ('m1@sent', 'm1', 'sent', 900, 1, 0, 0)`,
    ).run();
    await reconcileMailboxLocations(env, "inbox", []);
    expect(await uidsIn("inbox")).toEqual([]);
    // m1 still lives in Sent — keep the logical message.
    expect(await messagesWithNoLocations()).toBe(0);
  });

  it("removes locations when the folder is empty (all messages deleted)", async () => {
    await seedLocation("inbox", "m1", 100);
    await reconcileMailboxLocations(env, "inbox", []);
    expect(await uidsIn("inbox")).toEqual([]);
    expect(await messagesWithNoLocations()).toBe(0);
  });
});

describe("logicalMessageId", () => {
  function msg(messageId: string | null, remoteUid: number): ProviderMessage {
    return {
      providerId: String(remoteUid),
      remoteUid,
      messageId,
      subject: null,
      from: null,
      to: [],
      cc: [],
      date: null,
      internalDate: null,
      flags: [],
      size: null,
    };
  }

  it("shares one id for the same Message-ID across mailboxes", () => {
    const a = logicalMessageId("acct", msg("<a@b.c>", 1), "inbox|1|1");
    const b = logicalMessageId("acct", msg("<a@b.c>", 500), "sent|1|500");
    expect(a).toBe(b);
  });

  it("keeps Message-IDs distinct per account", () => {
    const a = logicalMessageId("acct-1", msg("<a@b.c>", 1), "inbox|1|1");
    const b = logicalMessageId("acct-2", msg("<a@b.c>", 1), "inbox|1|1");
    expect(a).not.toBe(b);
  });

  it("falls back to a per-location identity when no Message-ID exists", () => {
    const a = logicalMessageId("acct", msg(null, 1), "inbox|1|1");
    const b = logicalMessageId("acct", msg(null, 2), "inbox|1|2");
    expect(a).not.toBe(b);
  });
});
