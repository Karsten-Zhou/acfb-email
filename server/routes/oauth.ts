// OAuth route handlers for Google + Microsoft email providers.
// Flow: user clicks "Connect Gmail" -> GET /api/oauth/google/start
//      -> redirects to provider -> provider redirects to /api/oauth/google/callback
//      -> we exchange code, identify the mailbox owner, store encrypted
//         tokens, and create the account row. The stored access token is
//         later used for IMAP/SMTP XOAUTH2 authentication.
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomUUID } from "crypto";
import { HttpError } from "../http-error";
import { enqueueSync } from "../sync/sync-service";
import { randomToken, safeEqual } from "../utils/token";
import { decryptCredential, encryptCredential } from "../security/crypto";
import {
  buildAuthorizeUrl,
  exchangeCode,
  providerGet,
  refreshToken,
  tokenValid,
} from "../oauth/client";
import type { OAuthToken } from "../oauth/client";
import { configFor } from "../oauth/config";

const OAUTH_STATE_COOKIE = "ec_oauth_state";

function appOrigin(c: Context<{ Bindings: Env }>): string {
  return new URL(c.req.url).origin;
}

export const oauthRoutes = new Hono<{ Bindings: Env }>();

// GET /api/oauth/:provider/start?action=connect|reconnect
oauthRoutes.get("/:provider/start", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  const cfg = configFor(c.env, appOrigin(c), provider);
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new HttpError(503, `${provider} OAuth is not configured (missing secrets)`);
  }
  const state = randomToken();
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: appOrigin(c).startsWith("https://"),
    sameSite: "Lax",
    path: "/api/oauth",
    maxAge: 600,
  });
  const url = buildAuthorizeUrl(cfg, state);
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

  const cfg = configFor(c.env, appOrigin(c), provider);
  const token = await exchangeCode(cfg, code, cfg.redirectUri);

  const info = await fetchOwnerInfo(provider, token);

  // Reuse the account for this email, or create it in a neutral state.
  let accountId = await existingAccountId(c.env, info.email);
  const now = new Date().toISOString();
  if (!accountId) {
    accountId = randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO accounts
        (id, provider, name, email, display_name, state, sync_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 'healthy', 1, ?)`,
    )
      .bind(
        accountId,
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

  // Full sync (first sync or reconnect; `force` also recovers an auth_required
  // account). A failed enqueue must not break the OAuth redirect flow.
  try {
    await enqueueSync(c.env, accountId, "full", { force: true });
  } catch (err) {
    console.error("[sync-queue] enqueue failed for account", accountId, err);
  }

  // Back to Settings with a query flag so the page shows a success notice.
  return c.redirect(`${appOrigin(c)}/settings?connected=${provider}`);
});

async function fetchOwnerInfo(
  provider: "google" | "microsoft",
  token: OAuthToken,
): Promise<{ email: string; name: string | null }> {
  if (provider === "google") {
    const { status, json } = await providerGet(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      token.access_token,
    );
    if (status === 401) throw new HttpError(502, "Provider rejected token");
    const d = json as { email?: string; name?: string };
    if (!d.email) throw new HttpError(502, "Could not determine Gmail address");
    return { email: d.email, name: d.name ?? null };
  }
  // Outlook: the token endpoint returns an OIDC ID token alongside the
  // mail-scoped access token — that carries the owner's identity.
  const claims = token.id_token ? decodeIdToken(token.id_token) : null;
  const email = (claims?.email ?? claims?.preferred_username ?? "").toLowerCase();
  if (!email) throw new HttpError(502, "Could not determine Outlook address");
  return { email, name: claims?.name ?? null };
}

/** Decode an OIDC ID token's claims (base64url JWT payload). */
function decodeIdToken(
  idToken: string,
): { email?: string; name?: string; preferred_username?: string } | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as {
      email?: string;
      name?: string;
      preferred_username?: string;
    };
  } catch {
    return null;
  }
}

async function existingAccountId(env: Env, email: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT id FROM accounts WHERE lower(email) = lower(?)`)
    .bind(email)
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
  const parsed = JSON.parse(plain) as {
    type?: string;
    token?: OAuthToken;
    username?: string;
    password?: string;
  };
  if (parsed.type !== "oauth" || !parsed.token) return null;

  let tok = parsed.token;
  if (!tokenValid(tok)) {
    const cfg = configFor(env, "", account.provider === "gmail" ? "google" : "microsoft");
    tok = await refreshToken(cfg, tok.refresh_token);
    // Persist the refreshed token.
    const tokenBlob = JSON.stringify({ type: "oauth", token: tok });
    const encrypted = await encryptCredential(tokenBlob, env.CREDENTIAL_ENCRYPTION_KEY);
    await env.DB.prepare(`UPDATE account_credentials SET credential = ? WHERE account_id = ?`)
      .bind(encrypted, accountIdOf(account))
      .run();
  }
  return tok;
}

function accountIdOf(account: { provider: string } & Record<string, unknown>): string {
  return account.id as string;
}
