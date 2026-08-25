// Send routes: /api/send, /api/drafts
import { Hono } from "hono";
import { randomUUID } from "crypto";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { requireAuth } from "../auth";
import { currentUser } from "../auth/session";
import { buildProvider } from "../email/providers";
import { repo } from "../db/repo";
import { buildRawMessage } from "../email/compose";
import { readJson } from "../utils/http";
import { SendMessageInputSchema, DraftInputSchema } from "@shared/schemas";

export const sendRoutes = new Hono<{ Bindings: Env }>();
sendRoutes.use("*", requireAuth);

// POST /api/send
sendRoutes.post("/send", async (c) => {
  const user = currentUser(c);
  const input = await readJson(c, SendMessageInputSchema);

  const account = await repo.accountForUser(c.env, user.id, input.accountId);
  if (!account) throw new HttpError(404, "Account not found");
  const cred = await repo.credential(c.env, account.id);
  const provider = await buildProvider(account, cred ? { credential: cred } : null, c.env);

  const raw = buildRawMessage({
    from: { name: account.display_name, address: account.email },
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html: input.html,
    text: input.text,
    inReplyTo: input.inReplyTo,
    references: input.references,
    // New client-assembled files (base64) become MIME attachments.
    attachments: (input.newAttachments ?? []).map((a) => ({
      filename: a.name,
      contentType: a.mimeType,
      base64: a.base64,
    })),
  });

  try {
    await provider.send({
      from: account.email,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      rawMessage: raw,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    throw new HttpError(502, `Failed to send: ${message}`);
  }

  // Delete any saved draft with matching subject (simple heuristic: clear drafts for this account+subject)
  await c.env.DB.prepare(`DELETE FROM drafts WHERE user_id = ? AND account_id = ? AND subject = ?`)
    .bind(user.id, input.accountId, input.subject)
    .run();

  return c.json({ ok: true });
});

// POST /api/drafts  (save/update a draft)
sendRoutes.post("/drafts", async (c) => {
  const user = currentUser(c);
  const input = await readJson(c, DraftInputSchema);
  const id = input.id ?? randomUUID();
  const existing = await c.env.DB.prepare(`SELECT id FROM drafts WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first();
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE drafts SET account_id = ?, to_json = ?, cc_json = ?, bcc_json = ?, subject = ?, html = ?, text = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        input.accountId ?? null,
        JSON.stringify(input.to),
        JSON.stringify(input.cc),
        JSON.stringify(input.bcc),
        input.subject ?? null,
        input.html ?? null,
        input.text ?? null,
        new Date().toISOString(),
        id,
        user.id,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO drafts (id, user_id, account_id, to_json, cc_json, bcc_json, subject, html, text, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        user.id,
        input.accountId ?? null,
        JSON.stringify(input.to),
        JSON.stringify(input.cc),
        JSON.stringify(input.bcc),
        input.subject ?? null,
        input.html ?? null,
        input.text ?? null,
        new Date().toISOString(),
      )
      .run();
  }
  return c.json({ ok: true, id });
});

// GET /api/drafts
sendRoutes.get("/drafts", async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, account_id, to_json, cc_json, bcc_json, subject, html, text, updated_at
     FROM drafts WHERE user_id = ? ORDER BY updated_at DESC`,
  )
    .bind(user.id)
    .all<{
      id: string;
      account_id: string | null;
      to_json: string;
      cc_json: string;
      bcc_json: string;
      subject: string | null;
      html: string | null;
      text: string | null;
      updated_at: string;
    }>();
  const drafts = rows.results.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    to: JSON.parse(r.to_json) as string[],
    cc: JSON.parse(r.cc_json) as string[],
    bcc: JSON.parse(r.bcc_json) as string[],
    subject: r.subject,
    html: r.html,
    text: r.text,
    updatedAt: r.updated_at,
  }));
  return c.json({ drafts });
});

// DELETE /api/drafts/:id
sendRoutes.delete("/drafts/:id", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM drafts WHERE id = ? AND user_id = ?`).bind(id, user.id).run();
  return c.json({ ok: true });
});
