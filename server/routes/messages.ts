// Message routes: /api/messages
import { Hono } from "hono";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { requireAuth } from "../auth";
import { currentUser } from "../auth/session";
import { buildProvider } from "../email/providers";
import { repo } from "../db/repo";
import { readJson } from "../utils/http";
import {
  UpdateFlagsInputSchema,
  MoveMessagesInputSchema,
  DeleteMessagesInputSchema,
  MessageDetailSchema,
  MessageSchema,
} from "@shared/schemas";
import type { Message, MessageDetail } from "@shared/types";
import type { MessageRow } from "../db/repo";

export const messageRoutes = new Hono<{ Bindings: Env }>();
messageRoutes.use("*", requireAuth);

// GET /api/messages?mailboxId=...&limit=...&offset=...
messageRoutes.get("/", async (c) => {
  const user = currentUser(c);
  const mailboxId = c.req.query("mailboxId") ?? "";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  if (!mailboxId) throw new HttpError(400, "mailboxId is required");
  const box = await repo.mailboxForUser(c.env, user.id, mailboxId);
  if (!box) throw new HttpError(404, "Mailbox not found");

  const rows = await repo.listMessages(c.env, mailboxId, limit, offset);
  const messages = await rowsToMessages(c.env, rows);
  return c.json({ messages });
});

// GET /api/messages/unified?limit=...&offset=...
messageRoutes.get("/unified", async (c) => {
  const user = currentUser(c);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const boxes = await c.env.DB.prepare(
    `SELECT m.id FROM mailboxes m JOIN accounts a ON a.id = m.account_id
     WHERE a.user_id = ? AND (m.role = 'inbox' OR m.role = 'all')`,
  )
    .bind(user.id)
    .all<{ id: string }>();
  const rows = await repo.unifiedMessages(c.env, boxes.results.map((b) => b.id), limit, offset);
  const messages = await rowsToMessages(c.env, rows);
  return c.json({ messages });
});

// GET /api/messages/:id
messageRoutes.get("/:id", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await repo.messageForUser(c.env, user.id, id);
  if (!row) throw new HttpError(404, "Message not found");

  let html = row.html_preview;
  let text = row.text_preview;
  if (!row.body_fetched) {
    const account = await repo.accountForUser(c.env, user.id, row.account_id);
    if (!account) throw new HttpError(404, "Account not found");
    const cred = await repo.credential(c.env, account.id);
    const provider = await buildProvider(account, cred ? { credential: cred } : null, c.env);
    const body = await provider.fetchBody(row.provider_path, row.remote_uid!);
    html = body.html;
    text = body.text;
    await repo.markBodyFetched(c.env, row.id, html, text);
  }

  const detail = await rowToDetail(c.env, row, html, text);
  return c.json({ message: detail });
});

// PATCH /api/messages/flags
messageRoutes.patch("/flags", async (c) => {
  const user = currentUser(c);
  const input = await readJson(c, UpdateFlagsInputSchema);
  const owned = await repo.ownedMessageIds(c.env, user.id, input.ids);
  if (owned.length === 0) throw new HttpError(404, "No messages found");

  const byMailbox = new Map<string, typeof owned>();
  for (const r of owned) {
    const arr = byMailbox.get(r.mailbox_id) ?? [];
    arr.push(r);
    byMailbox.set(r.mailbox_id, arr);
  }

  for (const [mailboxId, msgs] of byMailbox) {
    const box = await repo.mailboxById(c.env, mailboxId);
    if (!box) continue;
    const account = await repo.accountById(c.env, box.account_id);
    if (!account) continue;
    const cred = await repo.credential(c.env, account.id);
    const provider = await buildProvider(account, cred ? { credential: cred } : null, c.env);
    const uids = msgs.map((m) => m.remote_uid).filter((n): n is number => n != null);
    const flags: { read?: boolean; starred?: boolean } = {};
    if (input.read !== undefined) flags.read = input.read;
    if (input.starred !== undefined) flags.starred = input.starred;
    await provider.setFlags(box.provider_path, uids, flags);
    for (const m of msgs) await repo.updateFlags(c.env, m.id, flags);
  }
  return c.json({ ok: true });
});

// POST /api/messages/move
messageRoutes.post("/move", async (c) => {
  const user = currentUser(c);
  const input = await readJson(c, MoveMessagesInputSchema);
  const target = await repo.mailboxForUser(c.env, user.id, input.targetMailboxId);
  if (!target) throw new HttpError(404, "Target mailbox not found");
  const owned = await repo.ownedMessageIds(c.env, user.id, input.ids);
  if (owned.length === 0) throw new HttpError(404, "No messages found");

  const byMailbox = new Map<string, typeof owned>();
  for (const r of owned) {
    const arr = byMailbox.get(r.mailbox_id) ?? [];
    arr.push(r);
    byMailbox.set(r.mailbox_id, arr);
  }
  for (const [mailboxId, msgs] of byMailbox) {
    const source = await repo.mailboxById(c.env, mailboxId);
    if (!source) continue;
    const account = await repo.accountById(c.env, source.account_id);
    if (!account) continue;
    const cred = await repo.credential(c.env, account.id);
    const provider = await buildProvider(account, cred ? { credential: cred } : null, c.env);
    const uids = msgs.map((m) => m.remote_uid).filter((n): n is number => n != null);
    await provider.move(source.provider_path, uids, target.provider_path);
    for (const m of msgs) await repo.moveMessage(c.env, m.id, target.id);
  }
  return c.json({ ok: true });
});

// POST /api/messages/delete
messageRoutes.post("/delete", async (c) => {
  const user = currentUser(c);
  const input = await readJson(c, DeleteMessagesInputSchema);
  const owned = await repo.ownedMessageIds(c.env, user.id, input.ids);
  if (owned.length === 0) throw new HttpError(404, "No messages found");

  const byMailbox = new Map<string, typeof owned>();
  for (const r of owned) {
    const arr = byMailbox.get(r.mailbox_id) ?? [];
    arr.push(r);
    byMailbox.set(r.mailbox_id, arr);
  }
  for (const [mailboxId, msgs] of byMailbox) {
    const box = await repo.mailboxById(c.env, mailboxId);
    if (!box) continue;
    const account = await repo.accountById(c.env, box.account_id);
    if (!account) continue;
    const cred = await repo.credential(c.env, account.id);
    const provider = await buildProvider(account, cred ? { credential: cred } : null, c.env);
    const uids = msgs.map((m) => m.remote_uid).filter((n): n is number => n != null);
    await provider.delete(box.provider_path, uids);
    for (const m of msgs) await repo.deleteMessage(c.env, m.id);
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------

async function rowsToMessages(env: Env, rows: MessageRow[]): Promise<Message[]> {
  const out: Message[] = [];
  for (const r of rows) {
    const recips = await repo.recipients(env, r.id);
    const to = recips.filter((x) => x.type === "to").map((x) => ({ name: x.name, address: x.address }));
    const cc = recips.filter((x) => x.type === "cc").map((x) => ({ name: x.name, address: x.address }));
    const bcc = recips.filter((x) => x.type === "bcc").map((x) => ({ name: x.name, address: x.address }));
    out.push(
      MessageSchema.parse({
        id: r.id,
        accountId: r.account_id,
        mailboxId: r.mailbox_id,
        subject: r.subject,
        snippet: r.snippet,
        from: r.from_address ? { name: r.from_name, address: r.from_address } : null,
        to,
        cc,
        bcc,
        date: r.date ?? r.received_at,
        receivedAt: r.received_at,
        isRead: !!r.is_read,
        isStarred: !!r.is_starred,
        hasAttachments: !!r.has_attachments,
        maybeThreadId: r.maybe_thread_id,
      }),
    );
  }
  return out;
}

async function rowToDetail(env: Env, row: MessageRow, html: string | null, text: string | null): Promise<MessageDetail> {
  const recips = await repo.recipients(env, row.id);
  const attachments = await repo.attachments(env, row.id);
  return MessageDetailSchema.parse({
    id: row.id,
    accountId: row.account_id,
    mailboxId: row.mailbox_id,
    subject: row.subject,
    snippet: row.snippet,
    from: row.from_address ? { name: row.from_name, address: row.from_address } : null,
    to: recips.filter((x) => x.type === "to").map((x) => ({ name: x.name, address: x.address })),
    cc: recips.filter((x) => x.type === "cc").map((x) => ({ name: x.name, address: x.address })),
    bcc: recips.filter((x) => x.type === "bcc").map((x) => ({ name: x.name, address: x.address })),
    date: row.date ?? row.received_at,
    receivedAt: row.received_at,
    isRead: !!row.is_read,
    isStarred: !!row.is_starred,
    hasAttachments: !!row.has_attachments,
    maybeThreadId: row.maybe_thread_id,
    html,
    text,
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mime_type,
      size: a.size,
      isInline: !!a.is_inline,
      contentId: a.content_id,
    })),
    remoteUid: row.remote_uid,
    remoteMessageId: row.remote_message_id,
  });
}