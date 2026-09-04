# Architecture

This document explains how ACFB Email is put together and why.

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

## 2. Component breakdown

| Component   | Path / Package              | Responsibility                                                                                                         |
| ----------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vue SPA     | `src/`                      | views, reactive stores, router (HTML5 history; deep links handled by the Workers SPA fallback), DOMPurify sanitization |
| Hono router | `server/index.ts`           | mounts `/api`, simple Cloudflare Access detection, error handling, logging middleware                                  |
| IMAP client | `imapflow` (patched)        | IMAP4rev1 over workerd `node:net`/`node:tls`/`node:stream`                                                             |
| SMTP client | `server/email/smtp.ts`      | submission via ports 587/465 (Workers forbid port 25)                                                                  |
| MIME parse  | `postal-mime`               | RFC5322/MIME parsing of received messages (verified Workers-compatible)                                                |
| MIME build  | `mimetext`                  | builds outgoing RFC5322 messages                                                                                       |
| Sync        | `server/sync/`              | orchestrates mailbox+message upsert; per-mailbox UID cursors                                                           |
| Repo        | `server/db/repo.ts`         | D1 access, ownership-scoped queries                                                                                    |
| Crypto      | `server/security/crypto.ts` | AES-GCM for stored credentials                                                                                         |
| Push        | `server/push/`              | Web Push (VAPID) via `web-push`; subscription CRUD + new-mail delivery + cross-device revoke                           |
| Shared      | `shared/`                   | Zod schemas + inferred types used by both ends                                                                         |

## 3. End-to-end flows

### Access & authentication

The Worker should be protected by Cloudflare Access. We have a simple Cloudflare Access detection middleware that rejects requests if Access is not enabled.

### Add account + first sync

1. Client POST /api/accounts (IMAP host/port, SMTP host/port, username, password)
2. Worker tests IMAP login first; on failure returns 400 (nothing persisted)
3. On success: stores account row + AES-GCM-encrypted credentials in separate table
4. Enqueue a sync job to the email-sync Queue
5. Sync: for each mailbox (LIST), SELECT, then UID SEARCH since last cursor, FETCH envelopes, upsert into D1 messages + locations + recipients

### Reading a message

1. GET /api/messages/:id
2. If body_fetched=0: open IMAP, SELECT mailbox, UID FETCH BODY.PEEK[],
   parse with postal-mime, store text/html previews, mark body_fetched=1
3. Return detail. The client always sanitizes HTML with DOMPurify before rendering

### Sending

1. POST /api/send { accountId, to, cc, bcc, subject, html, text, ... }
2. Worker builds RFC5322 with mimetext (multipart/alternative for html+text; client
   attachments are added as MIME parts)
3. SMTP: implicit TLS (465) or STARTTLS (587), AUTH LOGIN/PLAIN or XOAUTH2, MAIL FROM, RCPT TO, DATA
4. On success, the client deletes the provider-side draft it was composing

Email drafts are stored provider-side (IMAP APPEND to the Drafts folder).

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
push_subscriptions(id, account_id FK, endpoint, p256dh, auth, enabled, failure_count,
                  last_failure_at, last_delivered_at, UNIQUE(endpoint))
notification_deliveries(message_id FK, notification_type, status, created_at, delivered_at)
app_settings(id PK, data JSON)   -- singleton
```

**Design notes**

- `messages` is the logical email (one row per email, shared across folders — a self-sent mail lives in Inbox AND Sent as a single row). Its presence in a mailbox is a `message_locations` row that carries the provider identity (IMAP UID + UIDVALIDITY) and the per-location read/starred flags. A UID is only meaningful within `(mailbox, UIDVALIDITY)`, so it is a location identity, never a logical message identity.
- `messages.id` is deterministic (a hash of `account_id` + the Message-ID header, falling back to a per-location hash when absent), so sync is idempotent: re-running it upserts the same rows.
- `sync_state` is keyed **per mailbox** because IMAP UIDs are per-mailbox. The cursor (`uid_validity` + `last_uid`) only advances after every change it covers is durably applied (changes + cursor update share one D1 batch) and never regresses. On a UIDVALIDITY change the replacement set is fetched first, then the purge, imports, and cursor advance land in one atomic batch.
- Credentials live in a separate table so a query that dumps account metadata never accidentally includes ciphertext, let alone plaintext.
- We store only small text/html previews in `messages`. Full bodies are fetched from the provider on demand and cached as previews (max 64KB) after first read.
- Sync runs per mailbox (`server/sync/sync-service.ts`): a provider sync uses a cooperative AbortSignal (time budget) instead of racing a timeout, applies changes in one `env.DB.batch()`, then reconciles stale locations against the provider's current UID set and prunes orphaned messages.

## 5. Synchronization design

**Sync is enqueued, not inline**: every trigger (account add / OAuth connect, manual "Sync now", the 5-minute cron, the browser auto-check) pushes a job to the `email-sync` Queue; the `queue()` consumer runs it with 15-min wall-time (vs `waitUntil`'s 30 s).

**One sync per account**: enqueueing claims the account atomically (`claimAccountSync`), so a sync already queued/running discards new ones, and settling releases it. Enqueue helpers skip `auth_required` / `invalid_config` / `paused` accounts.

**Check vs full**: a job carries a `mode`. "full" syncs every mailbox + reconciles (add/connect, manual Sync now, send/draft refreshes). "check" is fast new-mail (inbox-only), used by the cron and the browser auto-check. The SPA polls `/api/accounts/states` (1 s while syncing, 60 s idle) and refreshes the lists when a sync settles — whichever trigger started it.

- `server/sync/` is split into three modules:
  - `sync-service.ts` — orchestration: `syncMailbox(accountId, mailboxId)` is the durable unit; `syncAccount` discovers mailboxes and runs one per folder (inbox-only in `check` mode); `importOlderPage` serves the load-older path. Queue payload: `{accountId, mailboxId?, mode?}`.
  - `sync-persistence.ts` — all D1 statement building + account/mailbox state, the logical-message identity (SHA-256), and `applyProviderMessages`.
  - `sync-reconciliation.ts` — stale-location delete + orphan prune.
- Sync runs within a hard time budget enforced by a cooperative `AbortSignal` (checked between provider round-trips) rather than a racing timeout — a cancelled sync never leaves a competing writer mutating the DB.
- Cursors are incremental (UID-based), so repeated syncs are cheap and never re-download the whole mailbox. `SYNC_FETCH_LIMIT` bounds messages per mailbox per run (default 100).

### How a mailbox sync works (IMAP)

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

## 6. Provider adapter

`ImapProvider` (`server/email/imap.ts`) is the mail adapter — an IMAP/SMTP implementation built on `imapflow`. Generic IMAP accounts authenticate with a password; Gmail and Outlook authenticate via OAuth2 (XOAUTH2) on their IMAP/SMTP endpoints. `buildProvider` (`server/email/build-provider.ts`) constructs it from a persisted account, selecting the transport and auth method.

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

- `imapflow` needs a small patch (kept in `patches/imapflow+1.7.8.patch`, re-applied by `patch-package` on `postinstall`) for two workerd stream-timing quirks: the `socketReadable` reentrancy race (workerd issue <https://github.com/cloudflare/workerd/issues/7136>) and an `ImapStream` input-drain race that otherwise drops large responses when `COMPRESS=DEFLATE` is on.

## 7. Cloudflare resource usage

| Resource             | Used? | Why                                                                                    |
| -------------------- | ----- | -------------------------------------------------------------------------------------- |
| Workers              | ✅    | Serves SPA + API (free-tier 100k req/day)                                              |
| D1                   | ✅    | Relational data (accounts, mailboxes, messages)                                        |
| Workers Assets       | ✅    | Serves the Vue SPA from edge (free)                                                    |
| `cloudflare:sockets` | ✅    | Outbound SMTP TCP                                                                      |
| KV                   | ❌    | Not needed for now; possible later for short-lived caches                              |
| R2                   | ❌    | Not needed for now                                                                     |
| Queues               | ✅    | Background account syncs (`email-sync` consumer) — 15-min wall-time                    |
| Cron                 | ✅    | 5-min new-mail checks (`scheduled` → enqueue `check` jobs; ~288 req/day)               |
| Browser Push         | ✅    | Web Push via `web-push` + `public/sw.js`; new-mail notifications + cross-device revoke |

### Free-tier risks

- **D1 500MB**: we store metadata + small previews only; full bodies/attachments are fetched on demand. Realistic personal mailboxes are far below the cap.
- **Requests/day (100k)**: a personal user with occasional syncs uses a rounding error of this budget.
- **6 simultaneous connections/request**: sync connects to one provider at a time (mailboxes sequentially); send uses one SMTP connection. Compliant.
- **Subrequests (50/invocation)**: sync iterates mailboxes sequentially; each mailbox costs ~4-6 IMAP commands over one socket (not subrequests). Compliant.
- **Worker memory 128MB**: literal FETCH of a single message body is bounded by request size limits; envelope fetches are chunked at 100 UIDs.
