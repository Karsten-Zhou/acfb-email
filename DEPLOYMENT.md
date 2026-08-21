# Deployment

End-to-end guide for shipping this app to Cloudflare Workers (Free tier).

---

## 0. What you'll end up with

- One Worker (`cloudflare-email-client`) serving the SPA + `/api`
- One D1 database (`cloudflare-email-client`)
- Secrets: GitHub OAuth, allowed-user id, credential-encryption key

---

## 1. Cloudflare account setup

1. Create a Cloudflare account (free) at <https://dash.cloudflare.com>.
2. Install Wrangler and log in:
   ```bash
   bun add -d wrangler
   bunx wrangler login
   ```
3. In your project, verify identity:
   ```bash
   bunx wrangler whoami
   ```

## 2. GitHub OAuth App setup

1. Go to GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**.
2. Homepage URL: your deployed URL (e.g. `https://your-worker.workers.dev`) or `http://localhost:8787` for local dev.
3. Authorization callback URL:
   - Local: `http://localhost:8787/api/auth/callback`
   - Production: `https://<your-worker>.workers.dev/api/auth/callback`
4. Copy the **Client ID** and generate a **Client Secret**.
5. Find your **numeric GitHub user ID**:
   ```bash
   curl -s https://api.github.com/user | jq .id   # your numeric id
   ```
   (Set `ALLOWED_GITHUB_USER_ID` to that number, not your username.)

## 3. Create secrets

```bash
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put ALLOWED_GITHUB_USER_ID
bunx wrangler secret put CREDENTIAL_ENCRYPTION_KEY
```

`CREDENTIAL_ENCRYPTION_KEY` must be **64 hex characters** (32 bytes). Generate:

```bash
bun -e "console.log([...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''))"
```

> These secrets are accessible only to your Worker at runtime; never put them in
> source control or the client bundle.

## 4. Create the D1 database

```bash
bunx wrangler d1 create cloudflare-email-client
```

The output shows a **database_id** UUID. Put it in `wrangler.jsonc`:

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "cloudflare-email-client",
  "database_id": "<paste-uuid>"
}]
```

Then apply migrations:

```bash
bunx wrangler d1 execute cloudflare-email-client --remote --file=./migrations/0001_initial.sql
```

## 5. Production environment variables

Set the production `APP_URL` (your deployed URL) in `wrangler.jsonc` under
`env.production.vars`, e.g.:

```jsonc
"env": {
  "production": {
    "vars": { "APP_URL": "https://your-worker.workers.dev", "SESSION_DAYS": "7" },
    "d1_databases": [/* as above */]
  }
}
```

When you deploy with `wrangler deploy --env production`, the `production`
environment's vars/bindings are used. Secrets (section 3) are shared across
environments unless overridden.

## 6. Deploy

```bash
bun run deploy
```

This runs `vite build` (producing `dist/`) and `wrangler deploy` using the
generated `dist/cloudflare_email_client/wrangler.json`.

First deployment asks you to confirm the Worker name and creates
`https://cloudflare-email-client.<you>.workers.dev`.

## 7. Post-deploy verification

1. Visit the URL → you should see the login screen.
2. Click "Continue with GitHub" → authorize → you land in the mailbox.
3. Add an IMAP/SMTP account (see below), press "Sync now", and confirm messages
   appear.

---

## Generic IMAP/SMTP accounts

The first provider is a generic IMAP/SMTP adapter. Connect accounts from
**Settings → Add account**:

| Field | Typical values |
| --- | --- |
| IMAP host | `imap.gmail.com`, `outlook.office365.com`, `imap.mail.yahoo.com`, your provider's |
| IMAP port | `993` (implicit TLS) or `143` (STARTTLS) |
| SMTP host | `smtp.gmail.com`, `smtp.office365.com`, etc. |
| SMTP port | `465` (implicit TLS) or `587` (STARTTLS) — **not 25** |
| Username / password | your login; for Gmail use an App Password |

**SMTP and SPF**: Cloudflare Workers block port 25 and send from Cloudflare's
outbound IP range (not your home/provider IP). If your receiving domains use
strict SPF, mail sent via this app may fail SPF alignment. Options:

- Use a provider whose SMTP you can reach on 465/587 and whose SPF you control
  (e.g. your own domain on a host that allows authenticated submission).
- Accept the limitation for personal use.
- Future Gmail/Outlook adapters use official APIs and sidestep this entirely.

---

## Rollback / recovery

- **Code rollback**: Wrangler keeps previous deployments; `bunx wrangler rollback`
  reverts to the last deployed version.
- **Data**: D1 is your authoritative store; nothing in the Worker is stateful.
  If you delete the Worker, your D1 data remains (delete it explicitly).
- **Lost encryption key**: credentials stored in D1 become undecryptable. There is
  no backdoor — export/rotate credentials first if you ever change the key.
- **Sessions**: users can simply log in again (sessions expire).

## Optional resources (deferred)

| Resource | When you'd add it | How |
| --- | --- | --- |
| Cron trigger | Background sync without manual refresh | add `triggers.crons` + `scheduled()` handler calling `syncAccount` |
| Queue | Batch sync jobs / retries | `wrangler queues create` + `queue()` consumer |
| R2 | Storing attachment bytes / bodies | add binding, move blob storage out of D1 |
| KV | Short-lived cache | optional binding |

Each is a small additive change; the architecture already isolates the seams
(`syncAccount`, provider interface, repo layer).