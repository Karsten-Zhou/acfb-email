// Mailbox routes: /api/mailboxes
import { Hono } from "hono";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { requireAuth } from "../auth";
import { currentUser } from "../auth/session";
import { MailboxSchema } from "@shared/schemas";
import type { Mailbox } from "@shared/types";

export const mailboxRoutes = new Hono<{ Bindings: Env }>();
mailboxRoutes.use("*", requireAuth);

// GET /api/mailboxes?accountId=...
mailboxRoutes.get("/", async (c) => {
  const user = currentUser(c);
  const accountId = c.req.query("accountId") ?? "";
  if (!accountId) throw new HttpError(400, "accountId is required");

  // ownership check
  const acct = await c.env.DB.prepare(`SELECT id FROM accounts WHERE id = ? AND user_id = ?`)
    .bind(accountId, user.id)
    .first();
  if (!acct) throw new HttpError(404, "Account not found");

  const rows = await c.env.DB.prepare(
    `SELECT id, account_id, name, role, provider_path, delimiter, total_messages, unseen_messages
     FROM mailboxes WHERE account_id = ?
     ORDER BY sort_order ASC, name ASC`,
  )
    .bind(accountId)
    .all<{
      id: string;
      account_id: string;
      name: string;
      role: string;
      provider_path: string | null;
      delimiter: string | null;
      total_messages: number | null;
      unseen_messages: number | null;
    }>();

  const mailboxes: Mailbox[] = rows.results.map((r) =>
    MailboxSchema.parse({
      id: r.id,
      accountId: r.account_id,
      name: r.name,
      role: r.role,
      providerPath: r.provider_path,
      delimiter: r.delimiter,
      totalMessages: r.total_messages,
      unseenMessages: r.unseen_messages,
    }),
  );
  return c.json({ mailboxes });
});
