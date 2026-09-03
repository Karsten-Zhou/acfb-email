// Shared helpers for the API integration tests.
//
// These tests exercise the Hono API through the Workers runtime (the
// `cloudflare:workers` `exports` fetch handler) with the local D1 binding.
// Migrations are applied once per worker by `e2e/apply-migrations.ts`
// (vitest setupFile). Because the tests share one D1 instance, each `describe`
// must call `clearDb()` in `beforeEach` to isolate itself.
import { env, exports } from "cloudflare:workers";

// `exports` is the Worker's default export; its fetch handler is invoked with
// a URL/Request. The `Env` binding type comes from the augmentation in
// `e2e/env.d.ts` (the Cloudflare runtime maps `env` to that namespace).
export type TestEnv = typeof env;

const worker = exports as unknown as {
  default: {
    fetch: (request: Request | string, init?: RequestInit) => Promise<Response>;
  };
};

/** Approve the request the way Cloudflare Access does in production. */
export const ACCESS_HEADER = {
  "cf-access-jwt-assertion": "test-access-jwt",
} as const;

/** Issue a request to the Worker's fetch handler under a full base URL. */
export async function api(path: string, init?: RequestInit): Promise<Response> {
  return worker.default.fetch(`http://localhost${path}`, init);
}

/** Convenience: fetch a JSON body as a typed value. Throws on non-2xx JSON. */
export async function apiJson<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  // Always carry the access header; merge caller headers (e.g. content-type)
  // on top so they don't drop it (the gate 403s otherwise).
  const res = await api(path, {
    ...init,
    headers: { ...ACCESS_HEADER, ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => undefined)) as T;
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// DB seeding + isolation
// ---------------------------------------------------------------------------

/** Children-first order so FK constraints (ON DELETE CASCADE) hold when wiping. */
const WIPE_TABLES = [
  "notification_deliveries",
  "push_subscriptions",
  "attachments",
  "message_recipients",
  "message_locations",
  "messages",
  "sync_state",
  "mailboxes",
  "account_credentials",
  "accounts",
  "app_settings",
] as const;

/** Delete every row from all tables. Call in `beforeEach` of a test group. */
export async function clearDb(env: TestEnv): Promise<void> {
  for (const t of WIPE_TABLES) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

export interface SeedAccount {
  id: string;
  provider?: string;
  name?: string;
  email?: string;
  state?: string;
  syncEnabled?: number;
  createdAt?: string;
  sortOrder?: number;
}

const nowIso = () => new Date().toISOString();

/** Insert an accounts row with defaults; returns the full row for assertions. */
export async function seedAccount(env: TestEnv, a: SeedAccount): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO accounts
       (id, provider, name, email, display_name, state, sync_enabled, created_at, sort_order)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  )
    .bind(
      a.id,
      a.provider ?? "imap",
      a.name ?? "Test account",
      a.email ?? `acc-${a.id}@example.com`,
      a.state ?? "healthy",
      a.syncEnabled ?? 1,
      a.createdAt ?? nowIso(),
      a.sortOrder ?? 0,
    )
    .run();
}

export interface SeedMailbox {
  id: string;
  accountId: string;
  name?: string;
  role?: string;
  providerPath?: string;
  totalMessages?: number | null;
  unseenMessages?: number | null;
  sortOrder?: number;
}

export async function seedMailbox(env: TestEnv, m: SeedMailbox): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO mailboxes
       (id, account_id, name, role, provider_path, total_messages, unseen_messages, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      m.id,
      m.accountId,
      m.name ?? m.role ?? "Mailbox",
      m.role ?? "other",
      m.providerPath ?? m.name ?? m.id,
      m.totalMessages ?? null,
      m.unseenMessages ?? null,
      m.sortOrder ?? 100,
    )
    .run();
}

export interface SeedMessage {
  id: string;
  accountId: string;
  mailboxId: string;
  uid: number;
  subject?: string;
  fromAddress?: string | null;
  fromName?: string | null;
  receivedAt?: string;
  isRead?: number;
  isStarred?: number;
  hasAttachments?: number;
  maybeThreadId?: string | null;
  /** Set with htmlPreview/textPreview to mark the body as already fetched. */
  bodyFetched?: number;
  htmlPreview?: string | null;
  textPreview?: string | null;
}

/**
 * Insert one logical message + its single location (the minimal row set the
 * list/detail routes expect). Returns nothing; seed data is read via the API.
 */
export async function seedMessage(env: TestEnv, m: SeedMessage): Promise<void> {
  const receivedAt = m.receivedAt ?? nowIso();
  await env.DB.prepare(
    `INSERT INTO messages
       (id, account_id, subject, from_name, from_address, date, received_at, has_attachments,
        maybe_thread_id, html_preview, text_preview, body_fetched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      m.id,
      m.accountId,
      m.subject ?? `Subject ${m.id}`,
      m.fromName ?? null,
      m.fromAddress ?? null,
      receivedAt,
      receivedAt,
      m.hasAttachments ?? 0,
      m.maybeThreadId ?? null,
      m.htmlPreview ?? null,
      m.textPreview ?? null,
      m.bodyFetched ?? 0,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO message_locations
       (id, message_id, mailbox_id, uid, uid_validity, is_read, is_starred)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(`${m.id}-loc`, m.id, m.mailboxId, m.uid, m.isRead ?? 0, m.isStarred ?? 0)
    .run();
}

/** Seed an account, a mailbox, and a single message — the common happy-path unit. */
export async function seedAccountMailboxMessage(
  env: TestEnv,
  opts: { accountId?: string; mailboxId?: string; messageId?: string; uid?: number } = {},
): Promise<{ accountId: string; mailboxId: string; messageId: string }> {
  const accountId = opts.accountId ?? "acct";
  const mailboxId = opts.mailboxId ?? "inbox";
  const messageId = opts.messageId ?? "msg1";
  await seedAccount(env, { id: accountId });
  await seedMailbox(env, { id: mailboxId, accountId, role: "inbox", name: "INBOX" });
  await seedMessage(env, { id: messageId, accountId, mailboxId, uid: opts.uid ?? 1 });
  return { accountId, mailboxId, messageId };
}
