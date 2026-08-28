// Message routes: /api/messages
import { Hono } from "hono";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { buildProvider } from "../email/providers";
import { repo } from "../db/repo";
import { importOlderPage } from "../sync/sync-service";
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
import type { ProviderBody } from "../email/providers/types";

export const messageRoutes = new Hono<{ Bindings: Env }>();

// GET /api/messages?mailboxId=...&limit=...&offset=...&beforeUid=...
messageRoutes.get("/", async (c) => {
  const mailboxId = c.req.query("mailboxId") ?? "";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const beforeUid = c.req.query("beforeUid")
    ? Math.max(parseInt(c.req.query("beforeUid")!, 10) || 0, 0)
    : 0;

  if (!mailboxId) throw new HttpError(400, "mailboxId is required");
  const box = await repo.mailboxById(c.env, mailboxId);
  if (!box) throw new HttpError(404, "Mailbox not found");

  let rows = await repo.listMessages(c.env, mailboxId, limit, offset);
  let hasMore = rows.length === limit;

  // If this is a load-older request and we ran out of local rows, ask the
  // provider for older messages and import them (so scrolling keeps working
  // beyond what was synced).
  if (offset > 0 && rows.length < limit && beforeUid > 0) {
    const account = await repo.accountById(c.env, box.account_id);
    if (account) {
      const res = await importOlderPage(
        c.env,
        { id: account.id, provider: account.provider },
        box.provider_path,
        beforeUid,
        limit,
      ).catch(() => ({ imported: 0, hasMore: false }));
      rows = await repo.listMessages(c.env, mailboxId, limit, offset);
      // Signal the client: the provider still has older mail we imported, so
      // the "No more messages" line must not appear — a further scroll should
      // import another page.
      hasMore = res.imported > 0;
    }
  }

  const messages = await rowsToMessages(c.env, rows);
  return c.json({ messages, hasMore });
});

// GET /api/messages/unified?limit=...&offset=...
messageRoutes.get("/unified", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  // For the unified inbox we only page the local DB (each provider's inbox is
  // imported when its own folder is scrolled). If the DB page runs short,
  // import one older page per account's inbox so the unified list keeps
  // growing instead of stopping at the local aggregate.
  const boxes = await c.env.DB.prepare(
    `SELECT id FROM mailboxes WHERE role = 'inbox' OR role = 'all'`,
  ).all<{ id: string }>();
  let rows = await repo.unifiedMessages(
    c.env,
    boxes.results.map((b) => b.id),
    limit,
    offset,
  );
  let hasMore = rows.length === limit;

  if (offset > 0 && rows.length < limit && boxes.results.length > 0) {
    let imported = 0;
    // Import one older page from each inbox so older mail shows up in the
    // unified list. Cursor = the oldest message in that inbox.
    for (const boxRow of boxes.results) {
      const box = await repo.mailboxById(c.env, boxRow.id);
      if (!box) continue;
      const account = await repo.accountById(c.env, box.account_id);
      if (!account) continue;
      const cursor = await c.env.DB.prepare(
        `SELECT remote_uid FROM messages WHERE mailbox_id = ? ORDER BY received_at ASC LIMIT 1`,
      )
        .bind(boxRow.id)
        .first<{ remote_uid: number | null }>();
      const beforeUid = cursor?.remote_uid ?? 0;
      if (beforeUid <= 0) continue;
      const res = await importOlderPage(
        c.env,
        { id: account.id, provider: account.provider },
        box.provider_path,
        beforeUid,
        Math.ceil(limit / Math.max(boxes.results.length, 1)),
      ).catch(() => ({ imported: 0, hasMore: false }));
      imported += res.imported;
    }
    rows = await repo.unifiedMessages(
      c.env,
      boxes.results.map((b) => b.id),
      limit,
      offset,
    );
    hasMore = imported > 0;
  }

  const messages = await rowsToMessages(c.env, rows);
  return c.json({ messages, hasMore });
});

// GET /api/messages/:id
messageRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await repo.messageById(c.env, id);
  if (!row) throw new HttpError(404, "Message not found");

  let html = row.html_preview;
  let text = row.text_preview;
  if (!row.body_fetched) {
    const account = await repo.accountById(c.env, row.account_id);
    if (!account) throw new HttpError(404, "Account not found");
    const cred = await repo.credential(c.env, account.id);
    const provider = await buildProvider(account, cred ? { credential: cred } : null, c.env);
    const providerId = providerIdFor(row);
    let body: ProviderBody;
    try {
      body = await provider.fetchBody(row.provider_path, providerId);
    } catch (err) {
      // The provider no longer has this message (e.g. a draft deleted
      // upstream). Prune the stale row so it drops out of the list, and tell
      // the client it's gone instead of surfacing a 500.
      if (isMessageGone(err)) {
        await repo.deleteMessage(c.env, row.id);
        throw new HttpError(410, "This message is no longer available", "message_gone");
      }
      throw err;
    }
    html = body.html;
    text = body.text;
    await repo.markBodyFetched(c.env, row.id, html, text);
    // Persist attachment metadata (names/sizes only — content stays upstream).
    const attRows = body.attachments.map((a) => ({
      filename: a.filename,
      mime_type: a.mimeType,
      size: a.size,
      is_inline: a.isInline ? 1 : 0,
      content_id: a.contentId,
      disposition: a.disposition,
      part_number: a.partNumber,
    }));
    await repo.replaceAttachments(c.env, row.id, attRows);
    if (attRows.length > 0) {
      await c.env.DB.prepare(`UPDATE messages SET has_attachments = 1 WHERE id = ?`)
        .bind(row.id)
        .run();
    }
  }

  const detail = await rowToDetail(c.env, row, html, text);
  return c.json({ message: detail });
});

// GET /api/messages/:id/attachments/:attachmentId
// Downloads an attachment by streaming it directly from the provider. Nothing
// is stored in Cloudflare infra — the binary travels provider -> worker ->
// browser on demand.
messageRoutes.get("/:id/attachments/:attachmentId", async (c) => {
  const id = c.req.param("id");
  const attachmentId = c.req.param("attachmentId");
  const row = await repo.messageById(c.env, id);
  if (!row) throw new HttpError(404, "Message not found");
  const att = await repo.attachmentById(c.env, attachmentId);
  if (!att || att.message_id !== row.id) throw new HttpError(404, "Attachment not found");

  const account = await repo.accountById(c.env, row.account_id);
  if (!account) throw new HttpError(404, "Account not found");
  const cred = await repo.credential(c.env, account.id);
  const provider = await buildProvider(account, cred ? { credential: cred } : null, c.env);
  const providerId = providerIdFor(row);
  try {
    const part = await provider.fetchAttachment(row.provider_path, providerId, att.part_number);
    const filename = (att.filename || "attachment").replace(/[\r\n"]/g, "_");
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
    const encoded = encodeURIComponent(ascii).replace(
      /['()*]/g,
      (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    c.header(
      "Content-Type",
      `${att.mime_type || part.mimeType || "application/octet-stream"}; charset=binary`,
    );
    c.header("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
    c.header("Content-Length", String(part.data.byteLength));
    c.header("Cache-Control", "private, no-store");
    // TS's BodyInit needs a view over ArrayBuffer (Uint8Array<ArrayBuffer>).
    const bytes = part.data as Uint8Array<ArrayBuffer>;
    return new Response(bytes, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Attachment download failed";
    throw new HttpError(502, `Failed to download attachment: ${message}`);
  }
});

// PATCH /api/messages/flags
messageRoutes.patch("/flags", async (c) => {
  const input = await readJson(c, UpdateFlagsInputSchema);
  const owned = await repo.ownedMessageIds(c.env, input.ids);
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
    const pids = msgs.map((m) => providerIdFor(m)).filter(Boolean);
    const flags: { read?: boolean; starred?: boolean } = {};
    if (input.read !== undefined) flags.read = input.read;
    if (input.starred !== undefined) flags.starred = input.starred;
    await provider.setFlags(box.provider_path, pids, flags);
    for (const m of msgs) await repo.updateFlags(c.env, m.id, flags);
    await repo.refreshUnseen(c.env, mailboxId);
  }
  return c.json({ ok: true });
});

// POST /api/messages/move
messageRoutes.post("/move", async (c) => {
  const input = await readJson(c, MoveMessagesInputSchema);
  const target = await repo.mailboxById(c.env, input.targetMailboxId);
  if (!target) throw new HttpError(404, "Target mailbox not found");
  const owned = await repo.ownedMessageIds(c.env, input.ids);
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
    const pids = msgs.map((m) => providerIdFor(m)).filter(Boolean);
    await provider.move(source.provider_path, pids, target.provider_path);
    for (const m of msgs) await repo.moveMessage(c.env, m.id, target.id);
    await repo.refreshUnseen(c.env, mailboxId);
    await repo.refreshUnseen(c.env, target.id);
  }
  return c.json({ ok: true });
});

// POST /api/messages/delete
messageRoutes.post("/delete", async (c) => {
  const input = await readJson(c, DeleteMessagesInputSchema);
  const owned = await repo.ownedMessageIds(c.env, input.ids);
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
    const pids = msgs.map((m) => providerIdFor(m)).filter(Boolean);
    try {
      await provider.delete(box.provider_path, pids);
    } catch (err) {
      // The object is already gone upstream — still prune the local rows so
      // a stale entry doesn't linger and 404 later.
      if (!isMessageGone(err)) throw err;
    }
    for (const m of msgs) await repo.deleteMessage(c.env, m.id);
    await repo.refreshUnseen(c.env, mailboxId);
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
    const to = recips
      .filter((x) => x.type === "to")
      .map((x) => ({ name: x.name, address: x.address }));
    const cc = recips
      .filter((x) => x.type === "cc")
      .map((x) => ({ name: x.name, address: x.address }));
    const bcc = recips
      .filter((x) => x.type === "bcc")
      .map((x) => ({ name: x.name, address: x.address }));
    out.push(
      MessageSchema.parse({
        id: r.id,
        accountId: r.account_id,
        mailboxId: r.mailbox_id,
        remoteUid: r.remote_uid,
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

async function rowToDetail(
  env: Env,
  row: MessageRow,
  html: string | null,
  text: string | null,
): Promise<MessageDetail> {
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
      disposition: a.disposition,
    })),
    remoteUid: row.remote_uid,
    remoteMessageId: row.remote_message_id,
  });
}

/**
 * The provider-side id of a message. All providers run over IMAP, where a
 * message is identified by its numeric UID within the mailbox (remote_uid).
 */
function providerIdFor(row: { remote_uid: number | null }): string {
  return String(row.remote_uid ?? "");
}
/** True when a provider error means the message no longer exists upstream. */
function isMessageGone(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b404\b/.test(msg) || /not found/i.test(msg) || /does not exist/i.test(msg);
}
