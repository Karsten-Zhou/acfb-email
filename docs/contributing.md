# Contributing

Guidance for AI coding agents and human contributors working in this repository. Keep this file updated when the architecture or conventions change.

## Project at a glance

A self-hosted, personal email client deployed to a single Cloudflare Worker:

- **Frontend**: Vue 3 SPA (TypeScript) in `src/`
- **Backend**: Hono API (TypeScript) in `server/`
- **Shared types/schemas**: in `shared/` (Zod schemas live in `shared/schemas.ts`, inferred types in `shared/types.ts`)

The frontend talks to the API through `src/lib/api.ts`. The provider and its types are defined in `server/email/`.

## Prerequisites

- [Bun](https://bun.sh) or [Node.js](https://nodejs.org)
- A [Cloudflare account](https://dash.cloudflare.com) (only for deploy/preview; local dev works without the account)

## First-time setup

```bash
bun install
cp .env.example .env
# Edit .env with real values:
#   CREDENTIAL_ENCRYPTION_KEY   (64 hex chars; generate below)
```

Generate a key:

```bash
bun -e "console.log([...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''))"
```

Apply local D1 schema:

```bash
bunx wrangler d1 migrations apply acfb-email --local
```

## Day-to-day commands

| Task                         | Command                                 |
| ---------------------------- | --------------------------------------- |
| Local dev server             | `bun run dev` → `http://localhost:5173` |
| Type check (all)             | `bun run typecheck`                     |
| Type check app only          | `bun run typecheck:app`                 |
| Type check worker only       | `bun run typecheck:server`              |
| Type check integration tests | `bun run typecheck:e2e`                 |
| Type check configs + scripts | `bun run typecheck:node`                |
| Unit + integration tests     | `bun run test`                          |
| Watch tests                  | `bun run test:watch`                    |
| Lint                         | `bun run lint`                          |
| Production build             | `bun run build`                         |
| Preview built output         | `bun run preview`                       |
| Deploy                       | `bun run deploy`                        |
| Docs (dev server)            | `bun run docs:dev`                      |
| Docs (static build)          | `bun run docs:build`                    |
| Format                       | `bun run format`                        |
| Format check (CI)            | `bun run format:check`                  |

- Prefer `bun run …` over `bun …` for scripts that call vitest/tsc — `bun <cmd>` can route to `bun:test` and ignore the vitest config.

### Testing notes

- Vitest runs through the **Cloudflare Workers runtime** via `@cloudflare/vitest-plugin` (the current official integration).
- Migrations are applied to the test DB automatically in `e2e/apply-migrations.ts`.
- Unit tests live next to the code (`*.test.ts`); integration tests in `e2e/`.

## Project structure

```text
src/                  Vue 3 SPA
  views/              Mailbox (3-pane), Message, Compose, Settings
    parts/            view-specific sub-components (panes, AccountSettings parts, …)
  composables/        reusable logic (useMessageActions, useMailboxSync, …)
  stores/             reactive singletons: accounts, mail, toast
  router/             web-history router
  lib/api.ts          typed fetch client
  styles/main.css     Tailwind v4 + email-body styles
server/               Worker (Hono)
  email/
    imap.ts           ImapProvider (imapflow)
    smtp.ts           SMTP submission client
    compose.ts        mimetext build
    build-provider.ts provider construction from account data
    role-map.ts       mailbox role detection
    types.ts          provider + shared types
  routes/             Hono route modules (accounts, mailboxes, messages, send, settings, oauth)
  sync/               syncAccount orchestrator
  security/           AES-GCM crypto
  db/repo.ts          D1 repository
  index.ts            app entry (mounts /api, error handler)
scripts/              standalone, helper scripts (e.g. `generate-vapid.ts`)
shared/               Zod schemas, constants, inferred types
migrations/           D1 SQL migrations
e2e/                  integration tests + migration setup
docs/                 VitePress documentation site
```

## Architecture / key seams

- **Single worker, SPA routing**: `src/router/index.ts` uses `createWebHistory`. Server redirects use plain paths — the Workers asset SPA fallback handles deep links. `/mail/message/:id` maps to `MailboxView`, which reads the route param and renders it in the rightmost reading pane on wide screens.
- **IMAP via `imapflow`**, patched for a workerd stream-timing quirk (`patches/imapflow@1.7.6.patch` — keep it in sync when bumping). SMTP is implemented over sockets in `server/email/smtp.ts`.
  - Don't pass `tls.rejectUnauthorized` to imapflow (workerd throws `ERR_OPTION_NOT_IMPLEMENTED`); pass an explicit `servername`.
  - **`COMPRESS=DEFLATE` must stay disabled** (`disableCompression: true` in `ImapProvider`) — workerd's compressed stream chain drops large responses, hanging the command.
  - Workers blocks outbound port 25 (SMTP); use 465/587.
- **MIME parsing**: `postal-mime` (zero-dep, Workers-safe; has `maxNestingDepth`/`maxHeadersSize` limits). `mimetext` builds MIME; its `setHeader In-Reply-To` expects a bare id (it adds the angle brackets itself).
- **Provider**: `server/email/imap.ts` is the mail adapter (`ImapProvider`, built on imapflow). Generic IMAP accounts use password auth; Gmail and Outlook authenticate via OAuth2 (XOAUTH2) on their well-known endpoints (`buildProvider` in `server/email/build-provider.ts`). The provider-side message id is the IMAP `remote_uid` (`providerIdFor()` in `server/routes/messages.ts`).
- **Syncing**: account add / OAuth connect enqueue a sync job to the `email-sync` Queue; the `queue()` consumer in `server/index.ts` runs it (15-min wall-time budget vs waitUntil's 30 s). A manual `POST /api/accounts/:id/sync` trigger also exists. `server/sync/` is split into three modules: `sync-service.ts` (orchestration — `syncMailbox` is the durable unit, `syncAccount` discovers mailboxes and syncs each, plus `importOlderPage`), `sync-persistence.ts` (all D1 statement building + account/mailbox state + the logical-message identity), and `sync-reconciliation.ts` (stale-location delete + orphan prune). The queue accepts `{accountId, mailboxId}` to retry a single mailbox.
- **Attachments are metadata-only on Cloudflare** — binary content is never stored in Worker infra. The download route re-fetches the part live from the provider on demand (`GET /api/messages/:id/attachments/:attachId`).

## Data model notes

- `messages` (logical emails) + `message_locations` (mailbox membership + per-location IMAP UID/UIDVALIDITY + read/starred flags) live in D1 (`migrations/0001_initial.sql`). A UID is a location identity, never the logical message: locations are keyed `UNIQUE(mailbox_id, uid_validity, uid)`. The logical message id is a SHA-256 of `(account_id, Message-ID)` when a header exists, else of the location — sync is idempotent (safe to run repeatedly) and a self-sent mail shares one row across Inbox + Sent.
- Sync invariants: a provider cursor only advances after every change it covers is durably applied. Message/location/recipient upserts are batched together, chunked to stay within D1's per-batch statement cap, with the cursor update always in the FINAL batch. Recipients are deduped by `UNIQUE(message_id, type, address)` + `INSERT OR IGNORE`. A location re-points to the latest logical message if the provider changes its Message-ID; orphaned messages are pruned each reconcile. On a UIDVALIDITY reset the replacement set is fetched FIRST, then the purge + imports + cursor land in one atomic batch (a failed re-fetch never empties the local folder). Reconciliation (full UID SEARCH + stale-location delete + orphan prune) runs each mailbox sync; IMAP has no incremental delete events, and the search is cheap relative to the envelope fetches it gates.
- `received_at` is stored via a normalized `isoDate()` (IMAP INTERNALDATE and provider ISO dates otherwise sort lexically wrong, e.g. `7-Mar-…` vs ISO).
- Account list ordering is user-controlled via `accounts.sort_order` (`PUT /api/accounts/order`).

## Conventions & quality bar

- **No `any`** outside exceptional interop; prefer Zod-inferred types.
- Runtime validate anything crossing a trust boundary (API bodies, provider data).
- Sync/send hot paths must be idempotent (see [architecture §5](./architecture.md#5-synchronization-design)).
- Never log credentials, tokens, cookies, or message bodies.
- Prefer the boring, well-tested option. If you deviate, document why in [architecture](./architecture.md).
- **Comment hygiene**: code comments describe only the _current_ implementation. Never mention abandoned/legacy/experimental approaches in code comments. Historical decision notes belong in `docs/`, not the code.
- Component naming: reusable components are `Ui*`-prefixed; follows the Vue multi-word component rule.
- **Composables**: reusable, domain-focused logic lives in `src/composables/`.
- Design system: custom Tailwind + semantic `oklch` tokens in `src/styles/main.css`, `cn()` in `src/lib/cn.ts`.
- i18n is in `src/lib/i18n.ts`; keys are nested in `src/locales/*.json`. `MessageKey` in `src/lib/i18n.ts` is a recursive path type over `en`, so keys are compile-time checked (typecheck), and `@intlify/eslint-plugin-vue-i18n` in `eslint.config.js` enforces key consistency across locales + no unused keys (lint). Keys reached only via dynamic lookup (`SYNC_ERROR_KEYS`, `ROLE_LABEL_KEY`) are ignored there. `en` is the fallback locale.
- Lint is expected to be warning-free.

## Security & sanitization

- The Worker should be protected by Cloudflare Access. We have a simple Cloudflare Access detection middleware that rejects requests if Access is not enabled.
- Email HTML is sanitized client-side with DOMPurify before `v-html`. The shared entry is `sanitizeHtml()` in `src/lib/sanitize.ts`:
  - Rewrites `cid:` inline-image references to the app's attachment endpoint. It lets DOMPurify parse & sanitize first (`RETURN_DOM`), then walks the already-clean output tree with DOM APIs — never regexes raw email HTML.
- `vue/no-v-html` is deliberately enabled only in the two views that render sanitized bodies (`MessageReaderPane.vue`, `MessageView.vue`).

## Live-behavior gotchas worth remembering

- **"Possible EventEmitter memory leak detected"** (per IMAP connection) is a benign workerd `node:net` bug, NOT our code/imapflow — ignore it; all listeners are freed when the socket closes, and it can't be disabled.
- **Gmail/Outlook OAuth scopes** (XOAUTH2 for IMAP/SMTP): Gmail needs `https://mail.google.com/`; Outlook needs `https://outlook.office.com/IMAP.AccessAsUser.All` + `SMTP.Send` (send is a separate scope).
- **Frontend server state is TanStack Query** (`@tanstack/vue-query`, plugin in `src/main.ts`, client + keys in `src/lib/query.ts`). Message lists are keyed infinite queries (`src/stores/mail.ts`); accounts/mailboxes/sidebar tree are cached queries (`src/stores/accounts.ts`); flags/move/delete/sync/add/etc. are mutations with optimistic updates + invalidation. Sync-state polling is a `useAccountStates()` query whose `refetchInterval` adapts (1s while any account is `running`, 60s idle) — TanStack guarantees non-overlapping fetches. Client/UI state (toasts, message selection, form/dialog refs) stays plain Vue reactivity; it is deliberately NOT in TanStack.
- Test-connection flow returns `{ ok, message }` so the UI can surface the real server rejection reason (e.g. "Basic authentication is disabled"). It verifies both IMAP (read) and SMTP (auth/submission) — `ImapProvider.testConnection()` runs the IMAP connect/logout then an SMTP connect→EHLO→STARTTLS→auth via `smtpTestConnection()` in `server/email/smtp.ts`.

## Adding a new API route

1. Create `server/routes/foo.ts` exporting `new Hono<EnvRoutes>()`.
2. Mount it in `server/index.ts`: `api.route("/foo", fooRoutes);`.
3. Add a Zod input schema in `shared/schemas.ts` if it takes a body.
4. Add a typed client method in `src/lib/api.ts`.
5. Add an integration test in `e2e/`.

## Troubleshooting

| Symptom                             | Likely cause / fix                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `/api/*` returns 503 at startup     | D1 binding misconfigured; check `database_id` in `wrangler.jsonc` (use zeros for local) |
| `Failed to load` in browser console | Dev server not running                                                                  |
| Type errors in editor but not CLI   | Restart the language server / `bun run typecheck` to sync tsbuildinfo                   |

## More documentation

- [Architecture](./architecture.md) — how the app is put together and why.
- [Deployment](./deployment.md) — shipping to Cloudflare Workers.
- [Security](./security.md) — threat model and controls.
