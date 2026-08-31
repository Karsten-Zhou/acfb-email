---
layout: home

hero:
  name: ACFB Email
  text: A self-hosted Cloudflare email client
  tagline: Connect IMAP/SMTP accounts and read, send, and organize mail through one unified interface — served from a single Cloudflare Worker.
  actions:
    - theme: brand
      text: Get started
      link: /development
    - theme: alt
      text: Architecture
      link: /architecture

features:
  - title: Cloudflare Access
    details: Sign in at the edge with your Cloudflare account — no app-level login.
  - title: Unified inbox
    details: All accounts in one list, with logical messages deduplicated across folders.
  - title: Incremental sync
    details: IMAP UID/UIDVALIDITY cursors and background sync via a Cloudflare Queue.
  - title: Safe by default
    details: Remote images hidden by default; email HTML sanitized with DOMPurify.
---

## Documentation

- [Development](./development.md) — daily workflow, commands, and conventions.
- [Architecture](./architecture.md) — how the application is put together and why.
- [Deployment](./deployment.md) — shipping to Cloudflare Workers.
- [Security](./security.md) — threat model and controls.
- [Contributing](./agents.md) — guidance for AI coding agents and contributors.
