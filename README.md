# ACFB Email Client

A Cloudflare based (ACFB) web email client that runs on **Cloudflare Workers (Free tier)**. Connect multiple email accounts and read, send, and organize mail through one unified interface.

![screenshot-1](docs/screenshots/image-1.jpeg)

## Features

- **Free & open source** — MIT licensed, no ads, no tracking, no telemetry; runs on Cloudflare's free tier.
- **Privacy-first** — your data stays in your Cloudflare account, protected by Cloudflare Access. No third parties involved.
- **A full email client** — connect almost any provider and read, send, and organize mail in one place.
- **Modern UX** — responsive, multilingual (i18n), and dark/light themes.

## Quick start

See [docs/development.md](./docs/development.md) for setup and day-to-day commands.

## Documentation

The full docs (VitePress) live under [`docs/`](./docs/): [architecture](./docs/architecture.md), [security](./docs/security.md), [development](./docs/development.md), and [deployment](./docs/deployment.md).

## Status & known limitations

- **SMTP port 25 is blocked by Cloudflare Workers**; use submission ports 587/465.
- Outbound email is sent from Cloudflare's IP, so SPF/DMARC records for your domain must include Cloudflare's sending IPs (or DNS-based SPF for the outbound range).
