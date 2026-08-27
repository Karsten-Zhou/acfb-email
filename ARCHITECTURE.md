# Architecture

This document explains how the application is put together and why. It is written
for a technically capable reader who does not assume prior knowledge of
Cloudflare/Workers internals.

---

## 1. Big picture

A single Cloudflare Worker serves both the **frontend** (a Vue 3 SPA, served via
Workers Assets) and the **backend** (a Hono API mounted under `/api/*`). The
browser talks only to our API; it never connects to your mail server or impersonates
you to a provider.

```text
Browser (Vue SPA)
   |
   | HTTP/JSON (HTTPS)
   v
Cloudflare Worker
   |- /api/auth/*     GitHub OAuth + sessions + CSRF
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

- The Cloudflare Vite plugin + Workers Assets is the current recommended way to ship
  a full-stack app to Workers (verified against official docs, 2026).
- No separate API origin, no CORS surface, simpler secrets/bindings.
- SPA fallback is free (assets are served by Cloudflare's edge, not the Worker).

---

## 2. Component breakdown

| Component | Path | Responsibility |
| --- | --- | --- |
| Vue SPA | `src/` | views, reactive stores, router (hash-based so deep links work without server rewrites), DOMPurify sanitization |
| Hono router | `server/index.ts` | mounts `/api`, error handling, CSRF + logging middleware |
| Auth | `server/auth/` | GitHub OAuth callback, session creation/validation, allowlist check, CSRF constant-time compare |
| IMAP client | `imapflow` (patched) | IMAP4rev1 over workerd `node:net`/`node:tls`/`node:stream` |
| SMTP client | `server/email/smtp/client.ts` | submission via ports 587/465 (Workers forbid port 25) |
| MIME parse | `postal-mime` | RFC5322/MIME parsing of received messages (verified Workers-compatible) |
| MIME build | `mimetext` | builds outgoing RFC5322 messages |
| Provider adapters | `server/email/providers/` | `IEmailProvider` interface; `ImapProvider` is the only adapter in v1 |
| Sync | `server/sync/` | orchestrates mailbox+message upsert; per-mailbox UID cursors |
| Repo | `server/db/repo.ts` | D1 access, ownership-scoped queries |
| Crypto | `server/security/crypto.ts` | AES-GCM for stored credentials |
| Shared | `shared/` | Zod schemas + inferred types used by both ends |

---

## 3. End-to-end flows

### Login flow

```text
1. Browser -> GET /api/auth/login
2. Worker sets ec_state cookie (random), redirects to GitHub /authorize
3. GitHub -> GET /api/auth/callback?code=...&state=...
4. Worker: verifies state (constant-time), exchanges code for token,
   fetches GitHub user, compares numeric id against ALLOWED_GITHUB_USER_ID
5. Creates/upserts users row, creates session:
     - random opaque token
     - stores SHA-256 hash in D1 sessions (DB leak does not grant sessions)
     - sets httpOnly Secure SameSite=Lax cookie (ec_session)
6. Sets CSRF cookie (ec_csrf, non-httpOnly so JS can read it back as a header)
7. Redirect to /mail
```

### Add account + first sync

```text
1. Client POST /api/accounts (IMAP host/port, SMTP host/port, username, password)
2. Worker tests IMAP login first; on failure returns 400 (nothing persisted)
3. On success: stores account row + AES-GCM-encrypted credentials in separate table
4. Fire-and-forget: syncAccount() (bounded; the request already returned)
5. Sync: for each mailbox (LIST), SELECT, then UID SEARCH since last cursor,
   FETCH envelopes, upsert into D1 messages + recipients
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
2. Worker builds RFC5322 with mimetext (multipart/alternative for html+text)
3. SMTP: implicit TLS (465) or STARTTLS (587), AUTH LOGIN, MAIL FROM, RCPT TO, DATA
4. On success, deletes any matching local draft
```

---

## 4. Data model (D1)

```text
users(id, github_id UNIQUE, github_login, display_name, avatar_url, created_at)
sessions(id=sha256(token), user_id FK, expires_at, revoked)
accounts(id, user_id FK, provider, name, email, display_name,
         imap_host/port/secure, smtp_host/port/secure,
         state, state_message, sync_enabled, created_at, last_synced_at)
account_credentials(account_id PK FK, credential=encrypted blob, updated_at)
mailboxes(id, account_id FK, name, role, provider_path, delimiter,
          total_messages, unseen_messages, sort_order)
messages(id, account_id FK, mailbox_id FK, remote_uid, remote_message_id,
         subject, snippet, from_name, from_address, date, received_at,
         is_read, is_starred, has_attachments, maybe_thread_id,
         text_preview, html_preview, body_fetched, raw_size, sync_hash)
message_recipients(id, message_id FK, type, name, address)
attachments(id, message_id FK, filename, mime_type, size, is_inline, content_id, disposition)
sync_state(account_id FK, mailbox_id FK, uid_validity, last_uid, last_sync_at,
           state, last_error, error_count, PRIMARY KEY(account_id, mailbox_id))
push_subscriptions(id, user_id FK, account_id FK, endpoint, p256dh, auth, enabled)
app_settings(user_id PK FK, data JSON)
drafts(id, user_id FK, account_id FK, to/cc/bcc JSON, subject, html, text, updated_at)
```

**Design notes**

- `messages.id` is our own UUID — remote UIDs and Message-IDs are **not** globally
  unique across providers, so we never use them as the internal PK.
- `sync_state` is keyed **per mailbox** because IMAP UIDs are per-mailbox. The
  cursor tracks `uid_validity` (detects mailbox resets) + `last_uid` (highest seen).
- Credentials live in a separate table so a query that dumps account metadata never
  accidentally includes ciphertext, let alone plaintext.
- We store only small text/html previews in `messages`. Full bodies are fetched
  from the provider on demand and cached as previews (max 64KB) after first read.

---

## 5. Synchronization design

**Sync is enqueued, not inline**: account add / OAuth connect push a job to the
`email-sync` Queue (`wrangler.jsonc` producer binding `SYNC_QUEUE`); the
`queue()` consumer in `server/index.ts` calls `syncAccount(env, accountId)`.
A queue consumer gets 15 minutes of wall-time (vs `waitUntil`'s 30 s), which a
slow multi-mailbox IMAP sync needs. A manual "Sync now" button still calls
`POST /api/accounts/:id/sync` synchronously.

- `syncAccount(env, accountId)` is the single entry point.
- Cursors are incremental (UID-based), so repeated syncs are cheap and never
  re-download the whole mailbox.
- `SYNC_FETCH_LIMIT` bounds the number of messages processed per account per run
  (default 100), protecting the Free tier.

### How UID sync works (IMAP)

```text
1. SELECT "INBOX"
2. Read UIDVALIDITY (server). If it changed vs last sync -> mailbox was reset,
   clear cursors and do a full scan.
3. UID SEARCH UID <last_uid+1>:*
4. UID FETCH <uids> (ENVELOPE FLAGS RFC822.SIZE INTERNALDATE)
5. Upsert each message; update last_uid to the max seen
```

---

## 6. Provider abstraction

`server/email/providers/types.ts` defines `IEmailProvider`:

- `testConnection()`
- `listMailboxes()`
- `syncMailbox(path, {sinceUid})`
- `fetchBody(path, uid)`
- `setFlags / move / delete`
- `send(opts)`

`ImapProvider` (imap.ts) implements it. Adding Gmail or Outlook later means adding
a new class + a `buildProvider` case — sync, routes, and UI do not change.

### IMAP via imapflow (patched)

`imapflow` is the IMAP engine, running on workerd's `node:net`/`node:tls`/
`node:stream` support. It needs one small patch (kept in
`patches/imapflow@1.7.6.patch`): workerd fires the stream `'readable'` event
earlier than Node — while imapflow's reader reentrancy guard is still held — so
a tagged response is dropped and the command never settles. The patch makes
`socketReadable` remember the missed event and re-run the reader (verified live
against QQ Mail, 2026-08-27); keep it in sync when bumping imapflow. imapflow
covers LIST, SELECT, SEARCH, FETCH, STORE flags, COPY, MOVE, DELETE, APPEND,
STARTTLS/implicit TLS, plus SPECIAL-USE folder detection and modified UTF-7
mailbox-name decoding. `COMPRESS=DEFLATE` is disabled in the provider
(`disableCompression: true`) because workerd's compressed stream chain drops
large responses (verified live against QQ Mail, 2026-08-27).

---

> **Status note (2026-08):** the IMAP/SMTP adapter is **tested live** (QQ Mail).
> The Gmail (REST) and Microsoft Graph adapters are **implemented but not yet
> live-verified** — they need Google Cloud / Entra app registrations with OAuth
> consent. Until verified, treat them as untested experimental code paths.

## 7. Cloudflare resource usage

| Resource | Used? | Why |
| --- | --- | --- |
| Workers | ✅ | Serves SPA + API (free-tier 100k req/day is far above personal use) |
| D1 | ✅ | Relational data (accounts, mailboxes, messages, sessions) |
| Workers Assets | ✅ | Serves the Vue SPA from edge (free) |
| `cloudflare:sockets` | ✅ | Outbound SMTP TCP (IMAP runs via workerd `node:net`/`node:tls`) |
| KV | ❌ | No need in v1; possible later for short-lived caches |
| R2 | ❌ | Deferred — attachments are metadata-only in v1 (documented) |
| Queues | ✅ | Background account syncs (`email-sync` consumer) — 15-min wall-time |
| Cron | ❌ | Not needed; sync is enqueued on add/connect + manual trigger |
| WebSockets/SSE | ❌ | Not needed for v1 (refresh + periodic sync model) |
| Browser Push | ⏳ | Table reserved; Service Worker + push to be wired in a later phase |

### Free-tier risks

- **D1 500MB**: we store metadata + small previews only; full bodies/attachments
  are fetched on demand. Realistic personal mailboxes are far below the cap.
- **Requests/day (100k)**: a personal user with occasional syncs uses a rounding
  error of this budget.
- **6 simultaneous connections/request**: sync connects to one provider at a time
  (mailboxes sequentially); send uses one SMTP connection. Compliant.
- **Subrequests (50/invocation)**: sync iterates mailboxes sequentially; each
  mailbox costs ~4-6 IMAP commands over one socket (not subrequests). Compliant.
- **Worker memory 128MB**: literal FETCH of a single message body is bounded by
  request size limits; envelope fetches are chunked at 100 UIDs.

---

## 8. Deviations from the spec & reasons

1. **HTML sanitization is client-side (browser), not in the Worker.** Current
   DOMPurify requires a DOM, which the Worker doesn't have. The Worker still
   only returns small text/html previews, and the client always runs DOMPurify
   before rendering. This is standard practice for email clients.
2. **Cron deferred; sync via Queue**: sync is enqueued on account add / OAuth
   connect and consumed by the `email-sync` Queue consumer (15-min wall-time,
   vs waitUntil's 30 s cap). `syncAccount` is the single entry point so a Cron
   trigger could be added later.
3. **Attachments are metadata-only in v1**: the `attachments` table tracks
   filename/type/size; binary content is not re-fetched for forwarding yet.
4. **POP3 is not implemented**: POP3 has materially weaker semantics than IMAP and
   would not provide inbox-style UX. Deferred; the provider interface allows a
   read/import-oriented adapter later.
5. **SMTP on port 25 is impossible from Workers** (verified in official docs); we
   use 587/465 submission. SPF implications are documented in DEPLOYMENT.md.