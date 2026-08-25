# AGENTS.md

Guidance for AI coding agents and human contributors working in this repository.
Keep this file updated when the architecture or conventions change. Be brief —
the goal is a quick orientation, not a full spec.

## Project at a glance

A self-hosted, personal email client deployed to a single Cloudflare Worker:

- **Frontend**: Vue 3 SPA (TypeScript) in `src/`
- **Backend**: Hono API (TypeScript) in `server/`
- **Shared types/schemas**: in `shared/` (Zod schemas live in `shared/schemas.ts`,
  inferred types in `shared/types.ts`)
- **Deployment**: Cloudflare Workers with Workers Assets
  (`wrangler.jsonc` uses `assets.not_found_handling=spa` and
  `run_worker_first=["/api/*"]`) — the SPA and one API worker ship together

The frontend talks to the API through `src/lib/api.ts`. Cross-provider abstractions
and their types are defined in `server/email/providers/`.

## Commands (bun)

| Task | Command |
| --- | --- |
| Dev server | `bun run dev` (Vite default port 5173; the Vite plugin stays on the default port) |
| Build | `bun run build` |
| Type-check app | `bun run typecheck:app` |
| Type-check server | `bun run typecheck:server` |
| Lint | `bun run lint` |
| Test | `bun run test` (vitest) |
| Format | `bun run format` |
| Deploy | `bun run deploy` (`vite build && wrangler deploy`) |
| Local DB migrate | `bunx wrangler d1 execute <DB> --local --file=./migrations/0001_initial.sql` |

- Prefer `bun run …` over `bun …` for scripts that call vitest/tsc — `bun <cmd>`
  can route to `bun:test` and ignore the vitest config.
- **Formatting is owned by Prettier 3.9.** After any manual edit, run
  `bun run format`; `bun run format:check` must pass in CI.

## Type-checking

Per-component TypeScript project references: Vue app (`tsconfig.app.json`, run via
`vue-tsc`) and server (`tsconfig.server.json`, run via `tsc`). Prefer targeted
type-checks when iterating; the full `bun run typecheck` covers both.

Some tooling details that matter:

- D1 test bindings and vars must live under `env.production` in `wrangler.jsonc`,
  and vitest uses `environment: "production"` so the bindings resolve.
- `database_id` in `wrangler.jsonc` must be a valid UUID (all-zeros is fine) or
  the worker 503s at startup.
- Workers Web Crypto: no `node:crypto`; byte helpers return `Uint8Array<ArrayBuffer>`
  to satisfy `subtle` API typing.

## Architecture / key seams

- **Single worker, SPA routing**: `src/router/index.ts` uses `createWebHistory`
  (no hash routing). Server redirects use plain paths — the Workers asset SPA
  fallback handles deep links. `/mail/message/:id` maps to `MailboxView`, which
  reads the route param and renders it in the rightmost reading pane on wide
  screens.
- **IMAP client is custom** — there is no Workers-compatible IMAP library, so
  `server/email/imap/client.ts` talks raw IMAP over Workers TCP sockets
  (`cloudflare:sockets`). Correspondingly, SMTP is implemented over sockets in
  `server/email/smtp/client.ts`.
  - `connect()` requires `allowHalfOpen` in SocketOptions; sockets support
    `secureTransport: on|off|starttls`.
  - Workers blocks outbound port 25 (SMTP); use 465/587.
- **MIME parsing**: `postal-mime` (zero-dep, Workers-safe; has
  `maxNestingDepth`/`maxHeadersSize` limits). `mimetext` builds MIME; its
  `setHeader In-Reply-To` expects a bare id (it adds the angle brackets itself).
- **Provider abstraction**: `server/email/providers/` defines `GmailProvider`,
  `MicrosoftProvider`, and an IMAP provider behind a common interface. Provider
  ids for a message are resolved via `providerIdFor()` in `server/routes/messages.ts`
  (IMAP uses `remote_uid`; Gmail/Graph use `remote_message_id`).
- **Syncing**: sync runs on login + manual trigger (Cron/Queues deferred; the
  seam is `syncAccount`). `server/sync/sync-service.ts` orchestrates
  mailbox/message fetching and upsert.
- **Attachments are metadata-only on Cloudflare** — binary content is never
  stored in Worker infra. The download route re-fetches the part live from the
  provider on demand (`GET /api/messages/:id/attachments/:attachId`).

## Data model notes

- `messages`/`mailboxes`/`attachments` live in D1 (`migrations/0001_initial.sql`).
  Message upsert is keyed by `(mailbox_id, remote_message_id)`;
  `received_at` is stored via a normalized `isoDate()` (IMAP INTERNALDATE and
  provider ISO dates otherwise sort lexically wrong, e.g. `7-Mar-…` vs ISO).
- Account list ordering is user-controlled via `accounts.sort_order`
  (`PUT /api/accounts/order`).
- Record failures/races discovered in production here (see repo memory for the
  live-sync polling race history) — the pattern is to reproduce live, then fix
  the polling/state machine so there is always a single poll chain.

## Security & sanitization

- Email HTML is sanitized client-side with DOMPurify before `v-html`. The shared
  entry is `sanitizeHtml()` in `src/lib/sanitize.ts`:
  - Re-allows the legacy presentational `align` attribute on table elements
    (ubiquitous in email HTML; safe, no URL surface).
  - Rewrites `cid:` inline-image references to the app's attachment endpoint.
    It lets DOMPurify parse & sanitize first (`RETURN_DOM`), then walks the
    already-clean output tree with DOM APIs — never regexes raw email HTML.
- `vue/no-v-html` is deliberately enabled only in the two views that render
  sanitized bodies (`MessageReaderPane.vue`, `MessageView.vue`).

## Conventions & quality bar

- **Comment hygiene**: code comments describe only the *current* implementation.
  Never mention abandoned/legacy/experimental approaches in code comments.
  Historical decision notes belong in this file or repo memory, not the code.
- Flat component naming: `src/components/UiButton.vue`, `UiInput.vue`,
  `UiToolTip.vue`, `UiSwitch.vue`, `UiDialog.vue`, `ToastHost.vue` (Vue
  multi-word component rule; components are `Ui*` prefixed).
- Design system: custom Tailwind + semantic `oklch` tokens in
  `src/styles/main.css`, `cn()` in `src/lib/cn.ts`.
- Lint is expected to be warning-free.
- Reference official docs for third-party libs and frameworks; avoid relying on
  reading `node_modules` source where documentation is available.

## Live-behavior gotchas worth remembering

- **SMTP**: Cloudflare Workers can't do port 25 — always 465/587.
- **MS Graph `Mail.Send`** is a separate delegated scope and is *not* included in
  `Mail.ReadWrite`; scopes are fixed at OAuth consent, so gaining send reconsent
  requires removing and reconnecting the account.
- Sync-state polling uses adaptive cadence (fast while any account is
  `running`, slow otherwise). Race conditions in this loop have bitten us — see
  the fast-poll/`clearAccountSyncing`/`runInFlight` guard notes in repo memory.
- The custom IMAP `WireReader` keeps raw byte counts for literals (decoded
  string length !== raw bytes for non-ASCII); splitting at the IMAP top level
  must track quotes so a space inside a quoted "name" doesn't mis-split.
- Test-connection flow returns `{ ok, message }` so the UI can surface the real
  IMAP server rejection reason (e.g. "Basic authentication is disabled").