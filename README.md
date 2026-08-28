# Cloudflare Email Client

A personal, polished web email client that runs on **Cloudflare Workers (Free tier)**.
Connect multiple email accounts (IMAP/SMTP first; Gmail/Microsoft via OAuth planned)
and read, send, and organize mail through one unified interface.

> This is a **personal, single-user** application. Access is gated by
> Cloudflare Access (only members of your Cloudflare account can sign in). It
> is not designed for multi-user hosting.

---

## Features (v1)

- 🔐 **Cloudflare Access** — sign in at the edge with your Cloudflare account; the worker refuses requests with no Access evidence
- 📬 **Connect IMAP/SMTP accounts** — test connection before saving; credentials encrypted with AES-GCM
- 📥 **Incremental mailbox sync** — IMAP UID/UIDVALIDITY cursors; sync on connect + manual refresh
- 📁 **Mailboxes & folders** — inbox, sent, drafts, trash, spam, archive recognition
- 📄 **Read email** — safe HTML/plain-text rendering (DOMPurify), attachments listing
- ✍️ **Compose & send** — plain text or HTML, CC/BCC, reply prefill, draft save/load
- ⭐ **Message state** — mark read/unread, star, move, delete
- 🌐 **Unified inbox** — all accounts in one list, preserving source account
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
bun dev                     # local dev (Vite + Cloudflare plugin)
```

Open <http://localhost:5173>. There is no app-level login: Cloudflare Access
gates the app at the edge in production, and local dev has no access controls.

---

## Repository layout

```
client/            ->  src/   Vue 3 SPA (views, stores, router, styles)
server/  ->  server/   Hono API + Workers runtime code
  email/            IMAP/SMTP clients, MIME parse/build, provider adapters
  routes/           Hono HTTP routes
  sync/             synchronization orchestrator
  security/         AES-GCM credential crypto
  db/               D1 repository layer
shared/            shared/types + Zod schemas + constants
migrations/        D1 schema migrations
e2e/               integration tests (Vitest + Cloudflare plugin)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design, [SECURITY.md](./SECURITY.md)
for the threat model, [DEVELOPMENT.md](./DEVELOPMENT.md) for daily workflow, and
[DEPLOYMENT.md](./DEPLOYMENT.md) for shipping to Cloudflare.

---

## Scripts

| Command | What it does |
| --- | --- |
| `bun dev` | Start local dev server (Vite + Workers runtime) |
| `bun build` | Production build (client + worker + output wrangler.json) |
| `bun preview` | Serve the production build locally |
| `bun typecheck` | `vue-tsc` (app) + `tsc` (worker) |
| `bun test` | Vitest (runs in Workers runtime via `@cloudflare/vitest-plugin`) |
| `bun lint` | ESLint |
| `bun deploy` | Build + `wrangler deploy` |

---

## Status & known limitations (v1)

- **Sending attachments** is not yet wired (send is text/HTML only). The data model
  supports attachment metadata; binary re-fetch for send/forward is a later phase.
- **Gmail & Outlook adapters are implemented but UNTESTED against real accounts**
  (they require Google Cloud / Microsoft Entra app registration + OAuth). The
  **IMAP/SMTP provider is the tested path** (verified with a real QQ Mail account).
  Outlook.com can also be connected via **IMAP/SMTP directly** (see below).
- **Background sync** is on account connect + manual "Sync now" (no Cron/Queues yet) — see
  ARCHITECTURE for the seam to add them.
- **SMTP port 25 is blocked by Cloudflare Workers**; use submission ports 587/465.
- Outbound email is sent from Cloudflare's IP, so SPF/DMARC records for your domain
  must include Cloudflare's sending IPs (or DNS-based SPF for the outbound range).

### Connecting Outlook.com via IMAP/SMTP (tested-compatible settings)

Outlook.com supports IMAP/SMTP with an app password:

| Field | Value |
| --- | --- |
| IMAP host | `outlook.office365.com` |
| IMAP port | `993`, TLS |
| SMTP host | `smtp.office365.com` |
| SMTP port | `587`, TLS (STARTTLS) |
| Username | your full email (e.g. `you@outlook.de`) |
| Password | an **app password** (Microsoft Account security settings → App passwords) |

See the [official Outlook POP/IMAP/SMTP settings](https://support.microsoft.com/outlook/pop-imap-and-smtp-settings-for-outlook-com)
for confirmed values.