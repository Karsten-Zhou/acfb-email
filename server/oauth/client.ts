// Generic OAuth 2.0 helper for third-party email providers (Google, Microsoft).
// Handles the authorization-code flow (server-side) and token refresh.
import { HttpError } from "../http-error";

export interface OAuthToken {
  access_token: string;
  refresh_token: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
  obtained_at: number; // epoch ms (we record this; providers may not return it)
}

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: (envBase: string) => string;
}

const SCOPE_DELIMITERS = {
  google: " ",
  microsoft: " ",
} as const;

/** Build the /authorize URL (authorization-code flow). */
export function buildAuthorizeUrl(
  cfg: OAuthProviderConfig,
  state: string,
): string {
  const qs = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri(""),
    scope: cfg.scopes.join(SCOPE_DELIMITERS.google),
    state,
    access_type: "offline",
    prompt: "consent",
  });
  // Gmail uses access_type=offline & prompt=consent to get a refresh token.
  return `${cfg.authorizeUrl}?${qs.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 * base = e.g. "http://localhost:5173" (used to build redirect_uri).
 */
export async function exchangeCode(
  cfg: OAuthProviderConfig,
  code: string,
  redirectUri: string,
): Promise<OAuthToken> {
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !data.access_token) {
    throw new HttpError(502, "Provider token exchange failed");
  }
  return normalizeToken(data);
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshToken(
  cfg: OAuthProviderConfig,
  refreshTokenValue: string,
): Promise<OAuthToken> {
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !data.access_token) {
    throw new HttpError(502, "Provider token refresh failed");
  }
  // Preserve the original refresh token if the provider didn't rotate it.
  return { ...normalizeToken(data), refresh_token: (data.refresh_token as string) ?? refreshTokenValue };
}

function normalizeToken(data: Record<string, unknown>): OAuthToken {
  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) ?? "",
    scope: (data.scope as string) ?? undefined,
    token_type: (data.token_type as string) ?? "Bearer",
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
    obtained_at: Date.now(),
  };
}

/** Compute whether an access token is (likely) still valid. */
export function tokenValid(tok: OAuthToken, slackMs = 60_000): boolean {
  if (!tok.expires_in) return true; // unknown -> assume valid
  return Date.now() - tok.obtained_at < (tok.expires_in * 1000) - slackMs;
}

/** Build redirect_uri for a provider from the app base URL. */
export function makeRedirectUri(baseUrl: string, provider: "google" | "microsoft"): string {
  return `${baseUrl.replace(/\/$/, "")}/api/oauth/${provider}/callback`;
}

/** Issue an authenticated GET to the provider, refreshing if needed. */
export async function providerGet(
  url: string,
  accessToken: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** Issue an authenticated POST with a JSON body. */
export async function providerJson(
  url: string,
  accessToken: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}