# Development

Everything you need to work on this project day to day.

---

## Prerequisites

- **Bun** >= 1.3 (package manager + runtime for scripts)
- Node 22+ (for some tooling internals)
- A Cloudflare account (only for deploy/preview; local dev works offline)

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
bunx wrangler d1 execute cloudflare-email-client --local --file=./migrations/0001_initial.sql
```

> During early development, editing an already-applied migration requires a
> local DB reset: delete `.wrangler/state` and re-apply (a reset also clears
> locally stored email accounts).

## Day-to-day commands

| Task | Command |
| --- | --- |
| Local dev server | `bun run dev` → http://localhost:5173 |
| Type check (both sides) | `bun run typecheck` |
| Type check app only | `bun run typecheck:app` |
| Type check worker only | `bun run typecheck:server` |
| Unit + integration tests | `bun run test` |
| Watch tests | `bun run test:watch` |
| Lint | `bun run lint` |
| Production build | `bun run build` |
| Preview built output | `bun run preview` |
| Deploy | `bun run deploy` |

### Testing notes

- Vitest runs through the **Cloudflare Workers runtime** via
  `@cloudflare/vitest-plugin` (the current official integration).
- Migrations are applied to the test DB automatically in
  `e2e/apply-migrations.ts`.
- Unit tests live next to the code (`*.test.ts`); integration tests in `e2e/`.

## Project structure

```text
src/                  Vue 3 SPA
  views/              Mailbox (3-pane), Message, Compose, Settings
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
    types.ts          IEmailProvider + shared types
  routes/             Hono route modules (accounts, mailboxes, messages, send, settings, oauth)
  sync/               syncAccount orchestrator
  security/           AES-GCM crypto
  db/repo.ts          D1 repository
  index.ts            app entry (mounts /api, error handler)
shared/               Zod schemas, constants, inferred types
migrations/           D1 SQL migrations
e2e/                  integration tests + migration setup
```

## Adding a new API route

1. Create `server/routes/foo.ts` exporting `new Hono<EnvRoutes>()`.
2. Mount it in `server/index.ts`: `api.route("/foo", fooRoutes);`.
3. Add a Zod input schema in `shared/schemas.ts` if it takes a body.
4. Add a typed client method in `src/lib/api.ts`.
5. Add an integration test in `e2e/`.

## Adding a new provider

1. Implement `IEmailProvider` (see `server/email/types.ts`).
2. Register it in `buildProvider` (`server/email/build-provider.ts`).
3. If it needs OAuth tokens, store them encrypted in `account_credentials`
   (see SECURITY.md) and refresh on use.
4. Update the add-account UI (`SettingsView.vue`) to offer the new provider.

## Conventions

- **No `any`** outside exceptional interop; prefer Zod-inferred types.
- Runtime validate anything crossing a trust boundary (API bodies, provider data).
- Sync/send hot paths must be idempotent (see ARCHITECTURE §5).
- Never log credentials, tokens, cookies, or message bodies.
- Prefer the boring, well-tested option. If you deviate, document why in
  ARCHITECTURE.md.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `bun dev` hangs on `Request.cf` timeout | Local miniflare talking to Cloudflare API through a proxy; disable proxy for `api.cloudflare.com` or retry |
| `/api/*` returns 503 at startup | D1 binding misconfigured; check `database_id` in `wrangler.jsonc` (use zeros for local) |
| IMAP connection fails locally | Verify host/port/security; Workers sockets blocked by proxy can mimic this — check with `curl -v imaps://...` |
| `Failed to load` in browser console | Dev server not running |
| Type errors in editor but not CLI | Restart the language server / `bun run typecheck` to sync tsbuildinfo |