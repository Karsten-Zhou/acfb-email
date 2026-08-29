// Unit tests for mailbox UID reconciliation (reconcileMailboxUids).
//
// The sync reconciles each mailbox's local rows against the provider's
// authoritative current UID set: a row whose UID is gone belongs to a message
// that moved away or was deleted, so it is removed — no Message-ID heuristics.
// A self-sent mail genuinely lives in Inbox AND Sent, so both rows survive
// because each folder's UID set still contains the message.
import { describe, it, expect, beforeEach } from "vitest";
import { env as testEnv } from "cloudflare:workers";
import type { Env } from "../env";
import { reconcileMailboxUids } from "./sync-service";

// The test binding is a real D1 database, but its type is the generic
// Cloudflare.Env — cast to the app's Env so env.DB type-checks.
const env = testEnv as unknown as Env;

const ACCOUNT = "acct-1";

async function seedMessage(mailboxId: string, id: string, remoteUid: number | null) {
  await env.DB.prepare(
    `INSERT INTO messages (id, account_id, mailbox_id, remote_uid, remote_message_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      ACCOUNT,
      mailboxId,
      remoteUid,
      `${mailboxId}-${remoteUid}`,
      "2026-01-01T00:00:00.000Z",
    )
    .run();
}

async function uidsIn(mailboxId: string): Promise<number[]> {
  const r = await env.DB.prepare(`SELECT remote_uid FROM messages WHERE mailbox_id = ?`)
    .bind(mailboxId)
    .all<{ remote_uid: number | null }>();
  return r.results
    .map((x) => x.remote_uid)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
}

beforeEach(async () => {
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

describe("reconcileMailboxUids", () => {
  it("keeps rows whose UID is still present in the folder", async () => {
    await seedMessage("inbox", "m1", 100);
    await seedMessage("inbox", "m2", 200);
    await reconcileMailboxUids(env, "inbox", [100, 200]);
    expect(await uidsIn("inbox")).toEqual([100, 200]);
  });

  it("deletes rows whose UID is gone (moved or deleted)", async () => {
    await seedMessage("inbox", "m1", 100);
    await seedMessage("inbox", "m2", 200);
    await reconcileMailboxUids(env, "inbox", [200]);
    expect(await uidsIn("inbox")).toEqual([200]);
  });

  it("keeps both copies of a self-sent message (present in Inbox AND Sent)", async () => {
    await seedMessage("inbox", "m-inbox", 700);
    await seedMessage("sent", "m-sent", 200);
    await reconcileMailboxUids(env, "inbox", [700]);
    await reconcileMailboxUids(env, "sent", [200]);
    expect(await uidsIn("inbox")).toEqual([700]);
    expect(await uidsIn("sent")).toEqual([200]);
  });

  it("leaves rows without a remote_uid alone", async () => {
    await seedMessage("inbox", "m-null", null);
    await reconcileMailboxUids(env, "inbox", [100]);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE id = 'm-null'`).first<{
      n: number;
    }>();
    expect(n?.n).toBe(1);
  });

  it("removes rows when the folder is empty (all messages deleted)", async () => {
    await seedMessage("inbox", "m1", 100);
    await reconcileMailboxUids(env, "inbox", []);
    expect(await uidsIn("inbox")).toEqual([]);
  });
});
