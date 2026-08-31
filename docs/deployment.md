# Deployment

Step-by-step guide for shipping ACFB Email to Cloudflare Workers (Free tier).

---

## 1. Cloudflare account setup

1. Create a Cloudflare account (free) at <https://dash.cloudflare.com>.
2. Install Wrangler and log in:

   ```bash
   bun add -d wrangler
   bunx wrangler login
   ```

3. Verify identity:

   ```bash
   bunx wrangler whoami
   ```

## 2. Cloudflare Access (production gatekeeper)

Configure in the Cloudflare dashboard / API — **Wrangler cannot create Access applications**, so this must be done manually.

1. If Zero Trust is not yet enabled, enable it once (<https://one.dash.cloudflare.com> → **Setup**).
2. **Workers & Pages** → select your Worker → **Access** tab.
3. Select **Protect this Worker behind Access**.
4. **Traffic scope**: All traffic (production + previews).
5. **Authentication policy**: **Cloudflare account** — only members of this account can sign in.
6. Select **Apply Access**.

### Cookie / CSRF settings

**Zero Trust → Access controls → Applications → Configure → Advanced settings → Cookie settings**:

- **SameSite**: **Lax**. Do not use `Strict` — Access will hit `ERR_TOO_MANY_REDIRECTS` with it.
- **HttpOnly**: enabled (default).

## 3. Create secrets

```bash
bunx wrangler secret put CREDENTIAL_ENCRYPTION_KEY
```

`CREDENTIAL_ENCRYPTION_KEY` must be **64 hex characters** (32 bytes). Generate:

```bash
bun -e "console.log([...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''))"
```

> Never commit secrets to source control or the client bundle.

## 4. Create the D1 database

```bash
bunx wrangler d1 create acfb-email
```

The output shows a **database_id** UUID. Put it in `wrangler.jsonc`:

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "acfb-email",
  "database_id": "<paste-uuid>"
}]
```

Then apply migrations:

```bash
bunx wrangler d1 execute acfb-email --remote --file=./migrations/0001_initial.sql
```

## 5. Create the sync queue

The `email-sync` Queue must exist before deploy (it's referenced in `wrangler.jsonc`):

```bash
bunx wrangler queues create email-sync
```

## 6. Deploy

```bash
bun run deploy
```

This runs `vite build` and `wrangler deploy`. First deployment asks you to confirm the Worker name and creates `https://acfb-email.<you>.workers.dev`.

## 7. Post-deploy verification

1. Visit the URL → sign in with your Cloudflare account (worker-level Access).
2. Add an IMAP/SMTP account (below), press "Sync now", and confirm messages appear.

---

## Generic IMAP/SMTP accounts

Connect accounts from **Settings → Add account**:

| Field               | Typical values                                                                    |
| ------------------- | --------------------------------------------------------------------------------- |
| IMAP host           | `imap.gmail.com`, `outlook.office365.com`, `imap.mail.yahoo.com`, your provider's |
| IMAP port           | `993` (implicit TLS) or `143` (STARTTLS)                                          |
| SMTP host           | `smtp.gmail.com`, `smtp.office365.com`, etc.                                      |
| SMTP port           | `465` (implicit TLS) or `587` (STARTTLS) — **not 25** (Workers block port 25)     |
| Username / password | your login; for Gmail use an App Password                                         |

**SPF caveat**: Workers send from Cloudflare's outbound IP range, so strict SPF domains may reject mail. Use an SMTP host you can reach on 465/587 and whose SPF you control, or accept the limitation for personal use.

---

## OAuth providers (Gmail / Outlook)

Set the secrets:

```bash
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
bunx wrangler secret put MICROSOFT_CLIENT_ID
bunx wrangler secret put MICROSOFT_CLIENT_SECRET
```

Then create the app registrations and set their redirect URIs:

| Provider              | Console                                                          | Redirect URI template                                            |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Google**            | <https://console.cloud.google.com/apis/credentials>              | `https://<your-worker>.workers.dev/api/oauth/google/callback`    |
| **Microsoft (Entra)** | <https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps> | `https://<your-worker>.workers.dev/api/oauth/microsoft/callback` |

For local development use `http://localhost:5173/api/oauth/<provider>/callback`.

### Microsoft Entra app (Outlook)

1. **App registrations → New registration**.
2. **Supported account types**: **"Personal Microsoft accounts only"**.
3. **Redirect URI**: the Microsoft callback above (Web platform).
4. Grant admin consent if your tenant requires it (not needed for personal MSA).

### Google Cloud app (Gmail)

1. **APIs & Services → OAuth consent screen** (External), add your Google account as a test user.
2. **Credentials → Create credentials → OAuth client ID** (Web), set the Gmail redirect URI above.
3. In the consent screen, add the scope `https://mail.google.com/`.

---

## Rollback / recovery

- **Code rollback**: `bunx wrangler rollback` reverts to the last deployed version.
- **Data**: D1 is the authoritative store; deleting the Worker does not delete the D1 database (delete it explicitly).
- **Lost encryption key**: stored credentials become undecryptable with no backdoor — rotate credentials before changing the key.
- **Access sessions**: sign out via your Cloudflare account session or by clearing browser cookies.
- **DB reset**: schema changes during early development may require recreating the database (`wrangler d1 delete` / re-create + re-apply migrations); connected accounts must then be re-added.
