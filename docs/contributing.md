# Contributing / Agent guidance

Guidance for AI coding agents and human contributors working in this repository. Keep this file updated when the architecture or conventions change. Be brief — the goal is a quick orientation, not a full spec.

## Project at a glance

A self-hosted, personal email client (**ACFB Email**) deployed to a single Cloudflare Worker:

- **Frontend**: Vue 3 SPA (TypeScript) in `src/`
- **Backend**: Hono API (TypeScript) in `server/`
- **Shared types/schemas**: in `shared/` (Zod schemas live in `shared/schemas.ts`, inferred types in `shared/types.ts`)
- **Deployment**: Cloudflare Workers with Workers Assets (`wrangler.jsonc` uses `assets.not_found_handling=spa` and `run_worker_first=["/api/*"]`) — the SPA and one API worker ship together

The frontend talks to the API through `src/lib/api.ts`. Cross-provider abstractions and their types are defined in `server/email/`.

## Commands (bun)

| Task              | Command                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| Dev server        | `bun run dev` (Vite default port 5173; the Vite plugin stays on the default port) |
| Build             | `bun run build`                                                                   |
| Type-check app    | `bun run typecheck:app`                                                           |
| Type-check server | `bun run typecheck:server`                                                        |
| Lint              | `bun run lint`                                                                    |
| Test              | `bun run test` (vitest)                                                           |
| Format            | `bun run format`                                                                  |
| Deploy            | `bun run deploy` (`vite build && wrangler deploy`)                                |
| Docs              | `bun run docs:dev` / `bun run docs:build` (VitePress)                             |
| Local DB migrate  | `bunx wrangler d1 execute <DB> --local --file=./migrations/0001_initial.sql`      |

- Prefer `bun run …` over `bun …` for scripts that call vitest/tsc — `bun <cmd>` can route to `bun:test` and ignore the vitest config.
- **Formatting is owned by Prettier 3.9.** After any manual edit, run `bun run format`; `bun run format:check` must pass in CI. Markdown (docs) is formatted too.

## Type-checking

Per-component TypeScript project references: Vue app (`tsconfig.app.json`, run via `vue-tsc`) and server (`tsconfig.server.json`, run via `tsc`). Prefer targeted type-checks when iterating; the full `bun run typecheck` covers both.

Some tooling details that matter:

- D1 test bindings and vars must live under `env.production` in `wrangler.jsonc`, and vitest uses `environment: "production"` so the bindings resolve.
- `database_id` in `wrangler.jsonc` must be a valid UUID (all-zeros is fine) or the worker 503s at startup.
- Workers Web Crypto: no `node:crypto`; byte helpers return `Uint8Array<ArrayBuffer>` to satisfy `subtle` API typing.

## Architecture / key seams

- **Access control**: worker-level Cloudflare Access gates the whole app at the edge (configured in the dashboard/API — `worker` destination + "Cloudflare account" policy; Wrangler cannot create Access apps). Access enforces before the Worker runs, so the Worker does no authentication of its own: no auth middleware, no per-user model, no app cookies. (With Workers Static Assets, `ctx.access` is not forwarded to the user Worker, so the app never reads Access identity either.)
- **Single worker, SPA routing**: `src/router/index.ts` uses `createWebHistory` (no hash routing). Server redirects use plain paths — the Workers asset SPA fallback handles deep links. `/mail/message/:id` maps to `MailboxView`, which reads the route param and renders it in the rightmost reading pane on wide screens.
- **IMAP via `imapflow`**, patched for a workerd stream-timing quirk (`patches/imapflow@1.7.6.patch` — keep it in sync when bumping). SMTP is implemented over sockets in `server/email/smtp.ts`.
  - Don't pass `tls.rejectUnauthorized` to imapflow (workerd throws `ERR_OPTION_NOT_IMPLEMENTED`); pass an explicit `servername`.
  - **`COMPRESS=DEFLATE` must stay disabled** (`disableCompression: true` in `ImapProvider`) — workerd's compressed stream chain drops large responses, hanging the command.
  - Workers blocks outbound port 25 (SMTP); use 465/587.
- **MIME parsing**: `postal-mime` (zero-dep, Workers-safe; has `maxNestingDepth`/`maxHeadersSize` limits). `mimetext` builds MIME; its `setHeader In-Reply-To` expects a bare id (it adds the angle brackets itself).
- **Provider abstraction**: `server/email/` defines a single `ImapProvider` (imapflow) behind a common interface. Generic IMAP accounts use password auth; Gmail and Outlook connect through the same adapter via OAuth2 (XOAUTH2) on their well-known endpoints (`buildProvider` in `server/email/build-provider.ts`). Provider ids for a message are resolved via `providerIdFor()` in `server/routes/messages.ts` (all providers use the IMAP `remote_uid`).
- **Syncing**: account add / OAuth connect enqueue a sync job to the `email-sync` Queue; the `queue()` consumer in `server/index.ts` runs it (15-min wall-time budget vs waitUntil's 30 s). A manual `POST /api/accounts/:id/sync` trigger also exists. `server/sync/` is split into three modules: `sync-service.ts` (orchestration — `syncMailbox` is the durable unit, `syncAccount` discovers mailboxes and syncs each, plus `importOlderPage`), `sync-persistence.ts` (all D1 statement building + account/mailbox state + the logical-message identity), and `sync-reconciliation.ts` (stale-location delete + orphan prune). The queue accepts `{accountId, mailboxId}` to retry a single mailbox.
- **Attachments are metadata-only on Cloudflare** — binary content is never stored in Worker infra. The download route re-fetches the part live from the provider on demand (`GET /api/messages/:id/attachments/:attachId`).

## Data model notes

- `messages` (logical emails) + `message_locations` (mailbox membership + per-location IMAP UID/UIDVALIDITY + read/starred flags) live in D1 (`migrations/0001_initial.sql`). A UID is a location identity, never the logical message: locations are keyed `UNIQUE(mailbox_id, uid_validity, uid)`. The logical message id is a SHA-256 of `(account_id, Message-ID)` when a header exists, else of the location — sync is idempotent (safe to run repeatedly) and a self-sent mail shares one row across Inbox + Sent.
- Sync invariants: a provider cursor only advances after every change it covers is durably applied. Message/location/recipient upserts are batched together, chunked to stay within D1's per-batch statement cap, with the cursor update always in the FINAL batch. Recipients are deduped by `UNIQUE(message_id, type, address)` + `INSERT OR IGNORE`. A location re-points to the latest logical message if the provider changes its Message-ID; orphaned messages are pruned each reconcile. On a UIDVALIDITY reset the replacement set is fetched FIRST, then the purge + imports + cursor land in one atomic batch (a failed re-fetch never empties the local folder). Reconciliation (full UID SEARCH + stale-location delete + orphan prune) runs each mailbox sync; IMAP has no incremental delete events, and the search is cheap relative to the envelope fetches it gates.
- `received_at` is stored via a normalized `isoDate()` (IMAP INTERNALDATE and provider ISO dates otherwise sort lexically wrong, e.g. `7-Mar-…` vs ISO).
- Account list ordering is user-controlled via `accounts.sort_order` (`PUT /api/accounts/order`).

## Security & sanitization

- Cloudflare Access (edge) is the authentication boundary. Access also handles CSRF at the edge: it issues a `CF_AppSession` CSRF cookie for the app domain (validated at Cloudflare's network) and supports a `SameSite` attribute on the `CF_Authorization` cookie (set to Lax — see [deployment](./deployment.md)). The app has no CSRF tokens of its own.
- Email HTML is sanitized client-side with DOMPurify before `v-html`. The shared entry is `sanitizeHtml()` in `src/lib/sanitize.ts`:
  - Rewrites `cid:` inline-image references to the app's attachment endpoint. It lets DOMPurify parse & sanitize first (`RETURN_DOM`), then walks the already-clean output tree with DOM APIs — never regexes raw email HTML.
- `vue/no-v-html` is deliberately enabled only in the two views that render sanitized bodies (`MessageReaderPane.vue`, `MessageView.vue`).

## Conventions & quality bar

- **Comment hygiene**: code comments describe only the _current_ implementation. Never mention abandoned/legacy/experimental approaches in code comments. Historical decision notes belong in `docs/` or repo memory, not the code.
- Component naming: reusable components are `Ui*`-prefixed (Vue multi-word component rule).
- **Composables**: reusable, domain-focused logic lives in `src/composables/`.
- Design system: custom Tailwind + semantic `oklch` tokens in `src/styles/main.css`, `cn()` in `src/lib/cn.ts`.
- i18n is backed by **vue-i18n** (Composition API) in `src/lib/i18n.ts`; keys are nested in `src/locales/*.json` (`common`, `mailbox`, `compose`, `message`, `accounts`, `settings`, `app`) and addressed by dotted path — e.g. `t("accounts.testConnection")`. `MessageKey` in `src/lib/i18n.ts` is a recursive path type over `en`, so keys are compile-time checked (typecheck), and `@intlify/eslint-plugin-vue-i18n` in `eslint.config.js` enforces key consistency across locales + no unused keys (lint). Keys reached only via dynamic lookup (`SYNC_ERROR_KEYS`, `ROLE_LABEL_KEY`) are ignored there. `en` is the fallback locale; a missing key falls back to `en`, then the raw key.
- Lint is expected to be warning-free.
- Reference official docs for third-party libs and frameworks; avoid relying on reading `node_modules` source where documentation is available.

## Live-behavior gotchas worth remembering

- **"Possible EventEmitter memory leak detected"** (per IMAP connection) is a benign workerd `node:net` bug, NOT our code/imapflow — ignore it; all listeners are freed when the socket closes, and it can't be disabled.
- **Gmail/Outlook OAuth scopes** (XOAUTH2 for IMAP/SMTP): Gmail needs `https://mail.google.com/`; Outlook needs `https://outlook.office.com/IMAP.AccessAsUser.All` + `SMTP.Send` (send is a separate scope).
- **Frontend server state is TanStack Query** (`@tanstack/vue-query`, plugin in `src/main.ts`, client + keys in `src/lib/query.ts`). Message lists are keyed infinite queries (`src/stores/mail.ts`); accounts/mailboxes/sidebar tree are cached queries (`src/stores/accounts.ts`); flags/move/delete/sync/add/etc. are mutations with optimistic updates + invalidation. Sync-state polling is a `useAccountStates()` query whose `refetchInterval` adapts (1s while any account is `running`, 60s idle) — TanStack guarantees non-overlapping fetches. Client/UI state (toasts, message selection, form/dialog refs) stays plain Vue reactivity; it is deliberately NOT in TanStack.
- imapflow decodes modified UTF-7 mailbox names to Unicode; provider mailbox `name`/`path` are already decoded, so no manual UTF-7 handling is needed.
- Test-connection flow returns `{ ok, message }` so the UI can surface the real server rejection reason (e.g. "Basic authentication is disabled"). It verifies both IMAP (read) and SMTP (auth/submission) — `ImapProvider.testConnection()` runs the IMAP connect/logout then an SMTP connect→EHLO→STARTTLS→auth via `smtpTestConnection()` in `server/email/smtp.ts`.

## More documentation

- [Development](./development.md) — day-to-day workflow and commands.
- [Architecture](./architecture.md) — how the app is put together and why.
- [Deployment](./deployment.md) — shipping to Cloudflare Workers.
- [Security](./security.md) — threat model and controls.
