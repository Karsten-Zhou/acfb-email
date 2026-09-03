# Deployment

Step-by-step guide for shipping ACFB Email to Cloudflare Workers (Free tier).

**Need help?** you can also give this page to an AI assistant and ask it to guide you through the step you are on.

> Note to AI agents: If you are an AI agent, consider asking the user providing a cloudflare token with proper permissions to automate the deployment process.

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

## 2. Deploy

```bash
bun run deploy
```

After deployment, Wrangler should show the Worker URL. It will normally look like: `https://<worker-name>.<your-subdomain>.workers.dev`. This is your email client URL. You might need the URL for the following steps.

## 3. Apply the migrations

```bash
bunx wrangler d1 migrations apply DB --remote
```

## 4. Create the core encryption secret

Run this command to generate a random, secure key:

```bash
bun -e "console.log([...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''))"
```

Save it securely to your Cloudflare Worker:

```bash
bunx wrangler secret put CREDENTIAL_ENCRYPTION_KEY
```

## 5. Cloudflare Access

Now that the Worker is deployed, protect it in the Cloudflare dashboard.

1. If Zero Trust is not yet enabled, enable it at <https://one.dash.cloudflare.com>.
2. Go to **Workers & Pages** → select your Worker → **Access** tab.
3. Click **Protect this Worker behind Access**.
   - **Scope**: All traffic
   - **Authentication policy**: **Cloudflare account** — only members of this account can reach this worker.

## 6. Configure OAuth providers (Optional)

_Skip this step if you don't plan to use Gmail or Outlook._

Gmail and Outlook require OAuth. Creating your own OAuth (for free) secures your privacy the best.

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

## 7. Configure browser push (optional)

To receive new-mail push notifications, generate a Web Push **VAPID** key pair and store it as Worker secrets. Skip this step to leave push disabled.

```bash
bun run scripts/generate-vapid.ts
```

Upload the printed values:

```bash
bunx wrangler secret put VAPID_PUBLIC_KEY
bunx wrangler secret put VAPID_PRIVATE_KEY
```

## 8. Done!

Now visit `https://<your-worker-name>.<your-cloudflare-subdomain>.workers.dev` and log in with your Cloudflare account. Enjoy!

## Rollback / recovery

- **Code rollback**: `bunx wrangler rollback` reverts to the last deployed version.
- **Data**: D1 is the authoritative store; deleting the Worker does not delete the database (it must be deleted explicitly).
- **Lost encryption key**: Stored credentials become undecryptable with no backdoor — rotate all connected email credentials before changing the key.
- **Access sessions**: Sign out via your Cloudflare account session or by clearing browser cookies.
