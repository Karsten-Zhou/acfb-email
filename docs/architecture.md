# Architecture

This document explains how ACFB Email is put together and why. It is written for a technically capable reader who does not assume prior knowledge of Cloudflare/Workers internals.

---

## 1. Big picture

A single Cloudflare Worker serves both the **frontend** (a Vue 3 SPA, served via Workers Assets) and the **backend** (a Hono API mounted under `/api/*`). The browser talks only to our API; it never connects to your mail server or impersonates you to a provider.

```text
Browser (Vue SPA)
   |
   | HTTPS (Cloudflare Access enforced at edge)
   v
Cloudflare Worker
   |- /api/accounts/* account CRUD + sync trigger
   |- /api/mailboxes  folder list
   |- /api/messages/* list / read / flags / move / delete
   |- /api/send       compose + send + drafts
   |- /api/settings   app settings
   |
   |- D1 (SQLite)     relational persistence
   |- cloudflare:sockets  outbound IMAP/SMTP to your mail provider
```

### Why one Worker?

- The Cloudflare Vite plugin + Workers Assets is the current recommended way to ship a full-stack app to Workers (verified against official docs, 2026).
- No separate API origin, no CORS surface, simpler secrets/bindings.
- SPA fallback is free (assets are served by Cloudflare's edge, not the Worker).

---

## 2. Component breakdown

| Component         | Path                        | Responsibility                                                                                                         |
| ----------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vue SPA           | `src/`                      | views, reactive stores, router (HTML5 history; deep links handled by the Workers SPA fallback), DOMPurify sanitization |
| Hono router       | `server/index.ts`           | mounts `/api`, error handling, logging middleware                                                                      |
| Cloudflare Access | dashboard/API               | edge gatekeeper (worker-level, account members only); CSRF handled at the edge via `CF_AppSession`                     |
| IMAP client       | `imapflow` (patched)        | IMAP4rev1 over workerd `node:net`/`node:tls`/`node:stream`                                                             |
| SMTP client       | `server/email/smtp.ts`      | submission via ports 587/465 (Workers forbid port 25)                                                                  |
| MIME parse        | `postal-mime`               | RFC5322/MIME parsing of received messages (verified Workers-compatible)                                                |
| MIME build        | `mimetext`                  | builds outgoing RFC5322 messages                                                                                       |
| Provider adapter  | `server/email/`             | `ImapProvider` (imapflow): IMAP/SMTP transport + auth per account                                                      |
| Sync              | `server/sync/`              | orchestrates mailbox+message upsert; per-mailbox UID cursors                                                           |
| Repo              | `server/db/repo.ts`         | D1 access, ownership-scoped queries                                                                                    |
| Crypto            | `server/security/crypto.ts` | AES-GCM for stored credentials                                                                                         |
| Shared            | `shared/`                   | Zod schemas + inferred types used by both ends                                                                         |

---

## 3. End-to-end flows

### Access & authentication

Cloudflare Access is the gatekeeper. In production the Worker is protected by a worker-level Access application (policy: **Cloudflare account** — only account members can sign in). Access enforces sign-in at the edge before the Worker runs, so the Worker does no authentication of its own: no auth middleware, no per-user model, no app cookies. (Behind the static-assets router, `ctx.access` is not even forwarded to the user Worker, so there is no Access identity to read either.)

CSRF is handled by Cloudflare Access at the edge, not by the app: Access issues a `CF_AppSession` CSRF cookie for the application domain, and the admin can set the `SameSite` attribute on the `CF_Authorization` cookie (see [deployment](./deployment.md)). The Worker therefore has no CSRF token of its own.

### Add account + first sync

```text
1. Client POST /api/accounts (IMAP host/port, SMTP host/port, username, password)
2. Worker tests IMAP login first; on failure returns 400 (nothing persisted)
3. On success: stores account row + AES-GCM-encrypted credentials in separate table
4. Enqueue a sync job to the email-sync Queue (the request has already returned)
5. Sync: for each mailbox (LIST), SELECT, then UID SEARCH since last cursor,
   FETCH envelopes, upsert into D1 messages + locations + recipients
```

### Reading a message

```text
1. GET /api/messages/:id
2. If body_fetched=0: open IMAP, SELECT mailbox, UID FETCH BODY.PEEK[],
   parse with postal-mime, store text/html previews, mark body_fetched=1
3. Return detail. The client always sanitizes HTML with DOMPurify before rendering
```

### Sending

```text
1. POST /api/send { accountId, to, cc, bcc, subject, html, text, ... }
2. Worker builds RFC5322 with mimetext (multipart/alternative for html+text; client
   attachments are added as MIME parts)
3. SMTP: implicit TLS (465) or STARTTLS (587), AUTH LOGIN/PLAIN or XOAUTH2, MAIL FROM, RCPT TO, DATA
4. On success, the client deletes the provider-side draft it was composing
```

Drafts are stored provider-side (IMAP APPEND to the Drafts folder); there is no local drafts table.

---

## 4. Data model (D1)

```text
accounts(id, provider, name, email, display_name,
         imap_host/port/secure, smtp_host/port/secure,
         state, state_message, sync_enabled, created_at, last_synced_at)
account_credentials(account_id PK FK, credential=encrypted blob, updated_at)
mailboxes(id, account_id FK, name, role, provider_path, delimiter,
          total_messages, unseen_messages, sort_order)
messages(id, account_id FK, subject, snippet, from_name, from_address, date,
         received_at, maybe_thread_id, has_attachments,
         text_preview, html_preview, body_fetched, raw_size)
message_locations(id, message_id FK, mailbox_id FK, uid, uid_validity,
                  is_read, is_starred, UNIQUE(mailbox_id, uid_validity, uid))
message_recipients(id, message_id FK, type, name, address)
attachments(id, message_id FK, filename, mime_type, size, is_inline, content_id, disposition)
sync_state(account_id FK, mailbox_id FK, uid_validity, last_uid, last_total,
           state, last_error, error_count, last_sync_at, last_success_at,
           PRIMARY KEY(account_id, mailbox_id))
push_subscriptions(id, account_id FK, endpoint, p256dh, auth, enabled)
app_settings(id PK, data JSON)   -- singleton
```

**Design notes**

- `messages` is the logical email (one row per email, shared across folders — a self-sent mail lives in Inbox AND Sent as a single row). Its presence in a mailbox is a `message_locations` row that carries the provider identity (IMAP UID + UIDVALIDITY) and the per-location read/starred flags. A UID is only meaningful within `(mailbox, UIDVALIDITY)`, so it is a location identity, never a logical message identity.
- `messages.id` is deterministic (a hash of `account_id` + the Message-ID header, falling back to a per-location hash when absent), so sync is idempotent: re-running it upserts the same rows.
- `sync_state` is keyed **per mailbox** because IMAP UIDs are per-mailbox. The cursor (`uid_validity` + `last_uid`) only advances after every change it covers is durably applied (changes + cursor update share one D1 batch) and never regresses. On a UIDVALIDITY change the replacement set is fetched first, then the purge, imports, and cursor advance land in one atomic batch.
- Credentials live in a separate table so a query that dumps account metadata never accidentally includes ciphertext, let alone plaintext.
- We store only small text/html previews in `messages`. Full bodies are fetched from the provider on demand and cached as previews (max 64KB) after first read.
- Sync runs per mailbox (`server/sync/sync-service.ts`): a provider sync uses a cooperative AbortSignal (time budget) instead of racing a timeout, applies changes in one `env.DB.batch()`, then reconciles stale locations against the provider's current UID set and prunes orphaned messages.

---

## 5. Synchronization design

**Sync is enqueued, not inline**: account add / OAuth connect push a job to the `email-sync` Queue (`wrangler.jsonc` producer binding `SYNC_QUEUE`); the `queue()` consumer in `server/index.ts` runs it. A queue consumer gets 15 minutes of wall-time (vs `waitUntil`'s 30 s), which a slow multi-mailbox IMAP sync needs. A manual "Sync now" button still calls `POST /api/accounts/:id/sync` synchronously.

- `server/sync/` is split into three modules:
  - `sync-service.ts` — orchestration: `syncMailbox(accountId, mailboxId)` is the durable unit; `syncAccount` discovers mailboxes and runs one per folder; `importOlderPage` serves the load-older path. The queue payload is `{accountId, mailboxId?}` so a single mailbox can be retried.
  - `sync-persistence.ts` — all D1 statement building + account/mailbox state, the logical-message identity (SHA-256), and `applyProviderMessages`.
  - `sync-reconciliation.ts` — stale-location delete + orphan prune.
- Sync runs within a hard time budget enforced by a cooperative `AbortSignal` (checked between provider round-trips) rather than a racing timeout — a cancelled sync never leaves a competing writer mutating the DB.
- Cursors are incremental (UID-based), so repeated syncs are cheap and never re-download the whole mailbox. `SYNC_FETCH_LIMIT` bounds messages per mailbox per run (default 100).

### How a mailbox sync works (IMAP)

```text
1. Load the mailbox cursor (uid_validity, last_uid) from sync_state.
2. SELECT + UID SEARCH 1:* (authoritative current UID set).
3. Fetch envelopes for UIDs > last_uid (or the newest page on first sync).
4. Upsert each message into `messages` + `message_locations` + recipients,
   chunked into batches (D1 caps batch size), with the cursor advance always in
   the FINAL batch — so it never advances past work that wasn't applied.
   last_uid never regresses.
5. Reconcile: drop locations whose UID is no longer in the set, prune orphaned
   logical messages.
6. On a UIDVALIDITY change: fetch the replacement set FIRST, then purge the
   mailbox's locations + imports + cursor advance land in one atomic batch
   (a failed re-fetch never empties the local folder). The cursor restarts at
   the newest page; older mail is backfilled by load-older.
```

---

## 6. Provider adapter

`ImapProvider` (`server/email/imap.ts`) is the mail adapter — an IMAP/SMTP implementation built on `imapflow`. Generic IMAP accounts authenticate with a password; Gmail and Outlook authenticate via OAuth2 (XOAUTH2) on their well-known IMAP/SMTP endpoints. `buildProvider` (`server/email/build-provider.ts`) constructs it from a persisted account, selecting the transport and auth method.

`ImapProvider` exposes:

- `testConnection()`
- `listMailboxes()`
- `syncMailbox(path, {sinceUid, beforeUid, fetchLimit}, signal?)`
- `fetchOlder(path, options)` — older page for load-older
- `findByMessageId(path, messageId)` — resolves a message's new UID after a move
- `fetchBody(path, uid)`
- `fetchAttachment(path, uid, partNumber)` — re-fetches binary bytes on demand
- `fetchRawMessage(path, uid)` — full RFC 5322 source (forward as .eml)
- `setFlags / move / delete`
- `send(opts)` — relays pre-built MIME over SMTP
- `saveDraft(opts)` — writes a draft to the provider's Drafts folder

### IMAP via imapflow (patched)

`imapflow` is the IMAP engine, running on workerd's `node:net`/`node:tls`/`node:stream` support. It needs one small patch (kept in `patches/imapflow@1.7.6.patch`): workerd fires the stream `'readable'` event earlier than Node — while imapflow's reader reentrancy guard is still held — so a tagged response is dropped and the command never settles. The patch makes `socketReadable` remember the missed event and re-run the reader (verified live against QQ Mail, 2026-08-27); keep it in sync when bumping imapflow. imapflow covers LIST, SELECT, SEARCH, FETCH, STORE flags, COPY, MOVE, DELETE, APPEND, STARTTLS/implicit TLS, plus SPECIAL-USE folder detection and modified UTF-7 mailbox-name decoding. `COMPRESS=DEFLATE` is disabled in the provider (`disableCompression: true`) because workerd's compressed stream chain drops large responses (verified live against QQ Mail, 2026-08-27).

---

> **Status note (2026-08):** the IMAP/SMTP adapter is **tested live** (QQ Mail). Gmail and Outlook authenticate via **OAuth2 (XOAUTH2)** — they need Google Cloud / Entra app registrations with OAuth consent to be configured before they can be verified against real accounts.

## 7. Cloudflare resource usage

| Resource             | Used? | Why                                                                 |
| -------------------- | ----- | ------------------------------------------------------------------- |
| Workers              | ✅    | Serves SPA + API (free-tier 100k req/day is far above personal use) |
| D1                   | ✅    | Relational data (accounts, mailboxes, messages)                     |
| Workers Assets       | ✅    | Serves the Vue SPA from edge (free)                                 |
| `cloudflare:sockets` | ✅    | Outbound SMTP TCP (IMAP runs via workerd `node:net`/`node:tls`)     |
| KV                   | ❌    | No need in v1; possible later for short-lived caches                |
| R2                   | ❌    | Deferred — attachments are metadata-only in v1 (documented)         |
| Queues               | ✅    | Background account syncs (`email-sync` consumer) — 15-min wall-time |
| Cron                 | ❌    | Not needed; sync is enqueued on add/connect + manual trigger        |
| WebSockets/SSE       | ❌    | Not needed for v1 (refresh + periodic sync model)                   |
| Browser Push         | ⏳    | Table reserved; Service Worker + push to be wired in a later phase  |

### Free-tier risks

- **D1 500MB**: we store metadata + small previews only; full bodies/attachments are fetched on demand. Realistic personal mailboxes are far below the cap.
- **Requests/day (100k)**: a personal user with occasional syncs uses a rounding error of this budget.
- **6 simultaneous connections/request**: sync connects to one provider at a time (mailboxes sequentially); send uses one SMTP connection. Compliant.
- **Subrequests (50/invocation)**: sync iterates mailboxes sequentially; each mailbox costs ~4-6 IMAP commands over one socket (not subrequests). Compliant.
- **Worker memory 128MB**: literal FETCH of a single message body is bounded by request size limits; envelope fetches are chunked at 100 UIDs.

---

## 8. Deviations from the spec & reasons

1. **HTML sanitization is client-side (browser), not in the Worker.** Current DOMPurify requires a DOM, which the Worker doesn't have. The Worker still only returns small text/html previews, and the client always runs DOMPurify before rendering. This is standard practice for email clients.
2. **Cron deferred; sync via Queue**: sync is enqueued on account add / OAuth connect and consumed by the `email-sync` Queue consumer (15-min wall-time, vs waitUntil's 30 s cap). `syncAccount` is the single entry point so a Cron trigger could be added later.
3. **Attachments are metadata-only**: the `attachments` table tracks filename/type/size/part handle; binary bytes are never stored in Cloudflare infra and are re-fetched live from the provider on download via `fetchAttachment`. Forward-as-attachment re-fetches the full raw source on demand.
4. **POP3 is not implemented**: POP3 has materially weaker semantics than IMAP and would not provide inbox-style UX. Deferred; the provider interface allows a read/import-oriented adapter later.
5. **SMTP on port 25 is impossible from Workers** (verified in official docs); we use 587/465 submission. SPF implications are documented in [deployment](./deployment.md).
