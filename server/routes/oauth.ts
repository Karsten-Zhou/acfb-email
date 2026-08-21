// OAuth route handlers for Google + Microsoft email providers.
// Flow: user clicks "Connect Gmail" -> GET /api/oauth/google/start
//      -> redirects to provider -> provider redirects to /api/oauth/google/callback
//      -> we exchange code, identify the mailbox owner via the provider API,
//         store encrypted tokens, and create the account row.
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomUUID } from "crypto";
import type { Env } from "../env";
import { HttpError } from "../http-error";
import { requireAuth, randomToken, safeEqual } from "../auth";
import { currentUser } from "../auth/session";
import { decryptCredential, encryptCredential } from "../security/crypto";
import { buildAuthorizeUrl, exchangeCode, providerGet, refreshToken, tokenValid } from "../oauth/client";
import type { OAuthToken } from "../oauth/client";
import { configFor } from "../oauth/config";

const OAUTH_STATE_COOKIE = "ec_oauth_state";

export const oauthRoutes = new Hono<{ Bindings: Env }>();
oauthRoutes.use("/callback", requireAuth);
oauthRoutes.use("/start", requireAuth);

// GET /api/oauth/:provider/start?action=connect|reconnect
oauthRoutes.get("/:provider/start", async (c) => {
  const user = currentUser(c);
  const provider = parseProvider(c.req.param("provider"));
  const cfg = configFor(c.env, provider);
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new HttpError(503, `${provider} OAuth is not configured (missing secrets)`);
  }
  const state = randomToken();
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: c.env.APP_URL.startsWith("https://"),
    sameSite: "Lax",
    path: "/api/oauth",
    maxAge: 600,
  });
  const url = buildAuthorizeUrl(cfg, state);
  void user;
  return c.redirect(url);
});

// GET /api/oauth/:provider/callback?code=...&state=...
oauthRoutes.get("/:provider/callback", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  const expected = getCookie(c, OAUTH_STATE_COOKIE) ?? "";
  if (!(await safeEqual(expected, state))) {
    throw new HttpError(400, "Invalid OAuth state");
  }
  setCookie(c, OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/api/oauth" });

  const cfg = configFor(c.env, provider);
  const redirectUri = cfg.redirectUri(c.env.APP_URL);
  const token = await exchangeCode(cfg, code, redirectUri);

  // Identify the user from the provider.
  const info = await fetchOwnerInfo(provider, token.access_token);

  const user = currentUser(c);

  // Look for an existing account with the same email; else create one.
  let accountId = await existingAccountId(c.env, user.id, info.email);
  const now = new Date().toISOString();
  if (accountId) {
    await c.env.DB.prepare(
      `UPDATE accounts SET state='healthy', state_message=NULL, last_synced_at = ? WHERE id = ?`,
    )
      .bind(now, accountId)
      .run();
  } else {
    accountId = randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO accounts
        (id, user_id, provider, name, email, display_name, state, sync_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'healthy', 1, ?)`,
    )
      .bind(
        accountId,
        user.id,
        provider === "google" ? "gmail" : "microsoft",
        info.name || info.email,
        info.email,
        info.name || null,
        now,
      )
      .run();
  }

  // Store the encrypted OAuth token (refresh token) as the credential blob.
  const tokenBlob = JSON.stringify({ type: "oauth", token });
  const encrypted = await encryptCredential(tokenBlob, c.env.CREDENTIAL_ENCRYPTION_KEY);
  await c.env.DB.prepare(
    `INSERT INTO account_credentials (account_id, credential) VALUES (?, ?)
     ON CONFLICT(account_id) DO UPDATE SET credential = excluded.credential`,
  )
    .bind(accountId, encrypted)
    .run();

  // Redirect back to settings with a success hash.
  return c.redirect(`${c.env.APP_URL}/#/settings?connected=${provider}`);
});

async function fetchOwnerInfo(
  provider: "google" | "microsoft",
  accessToken: string,
): Promise<{ email: string; name: string | null }> {
  if (provider === "google") {
    const { status, json } = await providerGet("https://www.googleapis.com/oauth2/v2/userinfo", accessToken);
    if (status === 401) throw new HttpError(502, "Provider rejected token");
    const d = json as { email?: string; name?: string };
    if (!d.email) throw new HttpError(502, "Could not determine Gmail address");
    return { email: d.email, name: d.name ?? null };
  }
  const { status, json } = await providerGet("https://graph.microsoft.com/v1.0/me", accessToken);
  if (status === 401) throw new HttpError(502, "Provider rejected token");
  const d = json as { mail?: string; userPrincipalName?: string; displayName?: string };
  const email = (d.mail || d.userPrincipalName || "").toLowerCase();
  if (!email) throw new HttpError(502, "Could not determine Outlook address");
  return { email, name: d.displayName ?? null };
}

async function existingAccountId(
  env: Env,
  userId: string,
  email: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT id FROM accounts WHERE user_id = ? AND lower(email) = lower(?)`,
  )
    .bind(userId, email)
    .first<{ id: string }>();
  return row?.id ?? null;
}

function parseProvider(v: string): "google" | "microsoft" {
  if (v === "google" || v === "microsoft") return v;
  throw new HttpError(400, "Unsupported OAuth provider");
}

/**
 * Load a provider's OAuth token for an account, refreshing if expired.
 * Returns null if the account isn't an OAuth provider.
 */
export async function loadOauthToken(
  env: Env,
  account: { provider: string },
  credentialBlob: string,
): Promise<OAuthToken | null> {
  if (account.provider !== "gmail" && account.provider !== "microsoft") return null;
  let plain: string;
  try {
    plain = await decryptCredential(credentialBlob, env.CREDENTIAL_ENCRYPTION_KEY);
  } catch {
    return null;
  }
  const parsed = JSON.parse(plain) as { type?: string; token?: OAuthToken; username?: string; password?: string };
  if (parsed.type !== "oauth" || !parsed.token) return null;

  let tok = parsed.token;
  if (!tokenValid(tok)) {
    const cfg = configFor(env, account.provider === "gmail" ? "google" : "microsoft");
    tok = await refreshToken(cfg, tok.refresh_token);
    // Persist the refreshed token.
    const tokenBlob = JSON.stringify({ type: "oauth", token: tok });
    const encrypted = await encryptCredential(tokenBlob, env.CREDENTIAL_ENCRYPTION_KEY);
    await env.DB.prepare(
      `UPDATE account_credentials SET credential = ? WHERE account_id = ?`,
    )
      .bind(encrypted, accountIdOf(account))
      .run();
  }
  return tok;
}

function accountIdOf(account: { provider: string } & Record<string, unknown>): string {
  return account.id as string;
}