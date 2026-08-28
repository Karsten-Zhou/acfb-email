// Account routes: /api/accounts
import { Hono } from "hono";
import { randomUUID } from "crypto";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { encryptCredential } from "../security/crypto";
import { ImapProvider } from "../email/imap";
import { syncAccount } from "../sync/sync-service";
import { readJson } from "../utils/http";
import {
  AddAccountInputSchema,
  TestConnectionInputSchema,
  AccountDetailSchema,
  AccountSummarySchema,
} from "@shared/schemas";
import type { AccountSummary } from "@shared/types";

export const accountRoutes = new Hono<{ Bindings: Env }>();

// GET /api/accounts
accountRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, name, email, display_name, state, state_message, created_at, last_synced_at, sort_order
     FROM accounts ORDER BY sort_order ASC, created_at ASC`,
  ).all<{
    id: string;
    provider: string;
    name: string;
    email: string;
    display_name: string | null;
    state: string;
    state_message: string | null;
    created_at: string;
    last_synced_at: string | null;
    sort_order: number;
  }>();
  const accounts: AccountSummary[] = rows.results.map((r) =>
    AccountSummarySchema.parse({
      id: r.id,
      provider: r.provider,
      name: r.name,
      email: r.email,
      displayName: r.display_name,
      state: r.state,
      stateMessage: r.state_message,
      createdAt: r.created_at,
      lastSyncedAt: r.last_synced_at,
      sortOrder: r.sort_order,
    }),
  );
  return c.json({ accounts });
});

// GET /api/accounts/states — lightweight live status of each account. Polled
// by the client so sidebar/settings reflect sync progress without a full page
// reload (sync runs server-side in the background via the sync queue).
accountRoutes.get("/states", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, state, state_message, last_synced_at FROM accounts`,
  ).all<{
    id: string;
    state: string;
    state_message: string | null;
    last_synced_at: string | null;
  }>();
  return c.json({
    accounts: rows.results.map((r) => ({
      id: r.id,
      state: r.state,
      stateMessage: r.state_message,
      lastSyncedAt: r.last_synced_at,
    })),
  });
});

// GET /api/accounts/:id
accountRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT id, provider, name, email, display_name, state, state_message,
            created_at, last_synced_at, imap_host, imap_port, imap_secure,
            smtp_host, smtp_port, smtp_secure, sync_enabled, sort_order
     FROM accounts WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!row) throw new HttpError(404, "Account not found");
  const detail = AccountDetailSchema.parse({
    id: row.id,
    provider: row.provider,
    name: row.name,
    email: row.email,
    displayName: row.display_name,
    state: row.state,
    stateMessage: row.state_message,
    createdAt: row.created_at,
    lastSyncedAt: row.last_synced_at,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    useTls: row.imap_secure !== 0,
    syncEnabled: row.sync_enabled !== 0,
    sortOrder: row.sort_order ?? 0,
  });
  return c.json({ account: detail });
});

// POST /api/accounts  (add IMAP account)
accountRoutes.post("/", async (c) => {
  const input = await readJson(c, AddAccountInputSchema);

  // Test the credentials before saving.
  const testProvider = new ImapProvider(
    {
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      imapSecure: input.imapSecure,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
    },
    { username: input.username, password: input.password },
    input.email,
  );
  try {
    await testProvider.testConnection();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection test failed";
    throw new HttpError(400, `Connection test failed: ${message}`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO accounts
      (id, provider, name, email, display_name,
       imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
       state, sync_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 1, ?)`,
  )
    .bind(
      id,
      input.provider,
      input.name,
      input.email,
      input.displayName || null,
      input.imapHost,
      input.imapPort,
      input.imapSecure ? 1 : 0,
      input.smtpHost,
      input.smtpPort,
      input.smtpSecure ? 1 : 0,
      now,
    )
    .run();

  // Encrypt credential (JSON of username/password)
  const credJson = JSON.stringify({ username: input.username, password: input.password });
  const encrypted = await encryptCredential(credJson, c.env.CREDENTIAL_ENCRYPTION_KEY);
  await c.env.DB.prepare(`INSERT INTO account_credentials (account_id, credential) VALUES (?, ?)`)
    .bind(id, encrypted)
    .run();

  // Enqueue the first sync. The queue consumer runs it with a 15-minute
  // wall-time budget (vs waitUntil's 30 s), so a slow multi-mailbox IMAP sync
  // has room to finish. A failed enqueue must not roll back the account row
  // already created above.
  try {
    await c.env.SYNC_QUEUE.send({ accountId: id });
  } catch (err) {
    console.error("[sync-queue] enqueue failed for account", id, err);
    // No sync will ever run for this account; revert the optimistic 'running'
    // so it isn't stuck showing as syncing forever.
    await c.env.DB.prepare(`UPDATE accounts SET state = 'healthy' WHERE id = ?`).bind(id).run();
  }

  const summary = AccountSummarySchema.parse({
    id,
    provider: input.provider,
    name: input.name,
    email: input.email,
    displayName: input.displayName || null,
    state: "running",
    stateMessage: null,
    createdAt: now,
    lastSyncedAt: null,
    sortOrder: 0,
  });
  return c.json({ account: summary }, 201);
});

// POST /api/accounts/test  (don't persist; just verify)
accountRoutes.post("/test", async (c) => {
  const input = await readJson(c, TestConnectionInputSchema);
  const testProvider = new ImapProvider(
    {
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      imapSecure: input.imapSecure,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
    },
    { username: input.username, password: input.password },
    input.email,
  );
  try {
    await testProvider.testConnection();
    return c.json({ ok: true, message: "Connection successful" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    // Return 200 so the client can read {ok:false, message}; a non-2xx makes
    // the generic client throw and lose the message.
    return c.json({ ok: false, message }, 200);
  }
});

// UPDATE /api/accounts/:id (display name, label, sync enabled, sort order)
accountRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    displayName?: string;
    syncEnabled?: boolean;
    sortOrder?: number;
  }>();

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (body.name !== undefined) {
    sets.push("name = ?");
    vals.push(body.name);
  }
  if (body.displayName !== undefined) {
    sets.push("display_name = ?");
    vals.push(body.displayName || null);
  }
  if (body.syncEnabled !== undefined) {
    sets.push("sync_enabled = ?");
    vals.push(body.syncEnabled ? 1 : 0);
  }
  if (body.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    vals.push(Math.max(0, Math.floor(body.sortOrder)));
  }
  if (sets.length === 0) return c.json({ ok: true });
  vals.push(id);
  await c.env.DB.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
  return c.json({ ok: true });
});

// PUT /api/accounts/order  { orderedIds: string[] } — set the user's account
// display order (each id's sort_order = its index).
accountRoutes.put("/order", async (c) => {
  const body = await c.req.json<{ orderedIds?: string[] }>();
  const ids = Array.isArray(body.orderedIds) ? body.orderedIds.slice(0, 50) : [];
  for (let i = 0; i < ids.length; i++) {
    await c.env.DB.prepare(`UPDATE accounts SET sort_order = ? WHERE id = ?`).bind(i, ids[i]).run();
  }
  return c.json({ ok: true });
});

// DELETE /api/accounts/:id
accountRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM accounts WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// POST /api/accounts/:id/sync  -> trigger sync now
accountRoutes.post("/:id/sync", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await syncAccount(c.env, id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    // syncAccount() persists a detailed, classified message to the account's
    // state_message before rethrowing the raw error — surface that (fall back
    // to the raw message). Return 200 so the client can read the raw
    // { ok:false, message } detail (a non-2xx would make the generic client
    // throw and lose the message).
    const row = await c.env.DB.prepare(`SELECT state_message FROM accounts WHERE id = ?`)
      .bind(id)
      .first<{ state_message: string | null }>();
    const message = row?.state_message ?? (err instanceof Error ? err.message : "Sync failed");
    return c.json({ ok: false, message }, 200);
  }
});
