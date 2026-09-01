# Deployment

Step-by-step guide for shipping ACFB Email to Cloudflare Workers (Free tier). Send this page to an AI if you are not sure how to do.

> If you are an AI agent, consider asking the user providing a cloudflare token with proper permissions to automate the deployment process.

## 0. Prerequisites

- [Bun](https://bun.sh) (recommended) or [Node.js](https://nodejs.org) (If using Node.js, replace `bun`/`bunx` with `npm`/`npx` in the commands below)
- A [Cloudflare account](https://dash.cloudflare.com)

## 1. Cloudflare account setup

1. Create a Cloudflare account (free) at <https://dash.cloudflare.com>.
2. Install dependencies and log in:

   ```bash
   bun install
   bunx wrangler login
   ```

## 2. Create the D1 database

Create the database first so its ID can be added to your configuration:

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

Then apply the migrations:

```bash
bunx wrangler d1 migrations apply acfb-email --remote
```

## 3. Create the sync queue

The `email-sync` Queue must exist before deployment, as it is referenced in `wrangler.jsonc`:

```bash
bunx wrangler queues create email-sync
```

## 4. Create the core encryption secret

Generate an encryption key:

```bash
bun -e "console.log([...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''))"
```

Save it securely to your Cloudflare Worker:

```bash
bunx wrangler secret put CREDENTIAL_ENCRYPTION_KEY
```

> Never commit secrets to source control or the client bundle.

## 5. Configure OAuth providers (Gmail / Outlook)

This step is optional. Follow this step only if you need to connect your Gmail or Outlook account.

Gmail and Outlook require OAuth. Create your own OAuth App (for free) is the only way to protect your privacy and avoid sharing credentials with a third party.

### Google Cloud app (Gmail)

1. Go to <https://console.cloud.google.com/auth/overview>.
2. Create a new project (or select an existing one).
3. **Audience -> Test users**: Add your Google account (the one you will use to log in).
4. **Clients → Create Client**
   - **Application type**: Web application
   - **Name**: ACFB Email Client (or whatever you like)
   - **Authorized JavaScript origins**: `https://<your-worker-name>.<your-cloudflare-subdomain>.workers.dev`
   - **Authorized redirect URIs**: `https://<your-worker-name>.<your-cloudflare-subdomain>.workers.dev/api/oauth/google/callback`
5. You should now have a **Client ID** and **Client Secret**.

### Microsoft Entra app (Outlook)

1. Go to <https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps>.
2. **App registrations → New registration**
   - **Name**: ACFB Email Client (or whatever you like)
   - **Supported account types**: Select **"Personal Microsoft accounts only"**.
   - **Redirect URI Platform**: Web
   - **Redirect URI**: `https://<your-worker-name>.<your-cloudflare-subdomain>.workers.dev/api/oauth/microsoft/callback`

### Set OAuth Secrets in Cloudflare

Once you have generated the credentials from the steps above, upload them:

```bash
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
bunx wrangler secret put MICROSOFT_CLIENT_ID
bunx wrangler secret put MICROSOFT_CLIENT_SECRET
```

## 6. Configure browser push (optional)

To receive new-mail push notifications, generate a Web Push **VAPID** key pair and
store it as Worker secrets. Skip this step to leave push disabled.

```bash
bun run vapid:generate
```

Upload the printed values:

```bash
bunx wrangler secret put VAPID_PUBLIC_KEY
bunx wrangler secret put VAPID_PRIVATE_KEY
```

Optionally set `VAPID_SUBJECT` (a `mailto:` or `https:` URI identifying the app) via
`wrangler.jsonc` `vars` or a secret; it defaults to `mailto:acfb-email@localhost`.
`VAPID_PUBLIC_KEY` is public (served to the browser for `pushManager.subscribe`);
`VAPID_PRIVATE_KEY` is a secret and never leaves the Worker.

## 7. Deploy

With the database, queue, and secrets in place, you can safely deploy:

```bash
bun run deploy
```

## 8. Cloudflare Access

Now that the Worker is deployed, protect it in the Cloudflare dashboard.

1. If Zero Trust is not yet enabled, enable it at <https://one.dash.cloudflare.com>.
2. Go to **Workers & Pages** → select your Worker → **Access** tab.
3. Click **Protect this Worker behind Access**.
   - **Scope**: All traffic
   - **Authentication policy**: **Cloudflare account** — only members of this account can reach this worker.

### Cookie / CSRF settings

1. Navigate to **Zero Trust → Access controls → Applications → Choose the application named something like `acfb-email - Cloudflare Workers` → Additional settings → Cookie settings**
   - **Same Site Attribute**: Lax
2. Click **Save**.

## 8. Done!

Now visit `https://<your-worker-name>.<your-cloudflare-subdomain>.workers.dev` and log in with your Cloudflare account. Enjoy!

## Rollback / recovery

- **Code rollback**: `bunx wrangler rollback` reverts to the last deployed version.
- **Data**: D1 is the authoritative store; deleting the Worker does not delete the database (it must be deleted explicitly).
- **Lost encryption key**: Stored credentials become undecryptable with no backdoor — rotate all connected email credentials before changing the key.
- **Access sessions**: Sign out via your Cloudflare account session or by clearing browser cookies.
- **DB reset**: Schema changes during early development may require recreating the database (`wrangler d1 delete` then recreate and migrate); connected email accounts must then be re-added.
