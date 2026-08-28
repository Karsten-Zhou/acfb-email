// Send routes: /api/send, /api/drafts
import { Hono } from "hono";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { buildProvider } from "../email/providers";
import { repo } from "../db/repo";
import { buildRawMessage } from "../email/compose";
import { readJson } from "../utils/http";
import { SendMessageInputSchema, DraftInputSchema } from "@shared/schemas";

export const sendRoutes = new Hono<{ Bindings: Env }>();

// POST /api/send
sendRoutes.post("/send", async (c) => {
  const input = await readJson(c, SendMessageInputSchema);

  const account = await repo.accountById(c.env, input.accountId);
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
      // REST providers (Graph/Gmail) build their own body from html/text;
      // without these the body goes out empty even though the raw MIME is built.
      html: input.html || undefined,
      text: input.text || undefined,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    throw new HttpError(502, `Failed to send: ${message}`);
  }

  return c.json({ ok: true });
});

// POST /api/drafts  (save/update a draft into the provider's Drafts folder)
sendRoutes.post("/drafts", async (c) => {
  const input = await readJson(c, DraftInputSchema);
  const account = await repo.accountById(c.env, input.accountId);
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
  });

  try {
    await provider.saveDraft({
      from: account.email,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      rawMessage: raw,
      html: input.html || undefined,
      text: input.text || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Draft save failed";
    throw new HttpError(502, `Failed to save draft: ${message}`);
  }
  return c.json({ ok: true });
});
