# ACFB Email Client

A Cloudflare based (ACFB) web email client that runs on **Cloudflare Workers (Free tier)**. Connect multiple email accounts (IMAP/SMTP — Gmail and Microsoft/Outlook via OAuth, generic accounts via password) and read, send, and organize mail through one unified interface.

> This is a **personal, single-user** application. Access is gated by Cloudflare Access at the edge (only members of your Cloudflare account can sign in). It is not designed for multi-user hosting.

---

## Features

- 🔐 **Cloudflare Access** — sign in at the edge with your Cloudflare account; no app-level login
- 📬 **Connect IMAP/SMTP accounts** — Gmail & Outlook via OAuth (XOAUTH2), generic accounts via password; test connection before saving; credentials encrypted with AES-GCM
- 📥 **Incremental mailbox sync** — IMAP UID/UIDVALIDITY cursors; background sync via a Cloudflare Queue on connect and on demand
- 📁 **Mailboxes & folders** — inbox, sent, drafts, trash, spam, archive recognition
- 📄 **Read email** — safe HTML/plain-text rendering (DOMPurify), attachments listed & downloadable
- ✍️ **Compose & send** — plain text or HTML, CC/BCC, reply prefill, attachments, draft save/load
- ⭐ **Message state** — mark read/unread, star, move, delete
- 🌐 **Unified inbox** — all accounts in one list, preserving source account (logical messages deduped)
- 📱 **Responsive** — 3-pane desktop, stacked/mobile navigation, bottom nav
- 🌗 **Dark mode** — via system preference

---

## Quick start

```bash
bun install
cp .env.example .env      # then fill in real values
bun run typecheck           # type check app + worker
bun run test                # unit + worker integration tests
bun run lint                # eslint
bun run dev                 # local dev (Vite + Cloudflare plugin)
```

Open <http://localhost:5173>. There is no app-level login: Cloudflare Access gates the app at the edge in production, and local dev is always "authenticated".

---

## Repository layout

```
src/        Vue 3 SPA (views, stores, router, styles, components)
server/     Hono API + Workers runtime code
  email/      IMAP/SMTP clients, MIME parse/build, provider adapters
  routes/     Hono HTTP routes
  sync/       synchronization orchestrator
  security/   AES-GCM credential crypto
  db/         D1 repository layer
shared/     shared/types + Zod schemas + constants
migrations/ D1 schema migrations
e2e/        integration tests (Vitest + Cloudflare plugin)
```

The full docs (VitePress) live under [`docs/`](./docs/): [architecture](./docs/architecture.md) for the design, [security](./docs/security.md) for the threat model, [development](./docs/development.md) for the daily workflow, and [deployment](./docs/deployment.md) for shipping to Cloudflare.

Run the docs locally with `bun run docs:dev`.

---

## Scripts

| Command              | What it does                                                     |
| -------------------- | ---------------------------------------------------------------- |
| `bun run dev`        | Start local dev server (Vite + Workers runtime)                  |
| `bun run build`      | Production build (client + worker)                               |
| `bun run preview`    | Serve the production build locally                               |
| `bun run typecheck`  | `vue-tsc` (app) + `tsc` (worker)                                 |
| `bun run test`       | Vitest (runs in Workers runtime via `@cloudflare/vitest-plugin`) |
| `bun run lint`       | ESLint                                                           |
| `bun run docs:dev`   | VitePress docs dev server                                        |
| `bun run docs:build` | Build the VitePress docs site                                    |
| `bun run deploy`     | Build + `wrangler deploy`                                        |

---

## Status & known limitations

- **SMTP port 25 is blocked by Cloudflare Workers**; use submission ports 587/465.
- Outbound email is sent from Cloudflare's IP, so SPF/DMARC records for your domain must include Cloudflare's sending IPs (or DNS-based SPF for the outbound range).
- **Forward** is not wired (only reply/reply-all); attachments go on new or replied messages, not forwarded ones.
