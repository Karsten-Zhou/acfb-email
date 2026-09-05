// Cloudflare Access: the subset of a verified Access JWT's identity claims
// this app surfaces. Fields are optional because presence depends on the
// identity provider and whether Cloudflare included them. Per Cloudflare docs
// ("Application token"), the identity-auth JWT payload carries aud, email, exp,
// iat, iss, nbf, type, sub, country, and (only if configured and under ~1KB) a
// best-effort `groups` custom claim. It does NOT carry name/ip/geo — those come
// from the /cdn-cgi/access/get-identity endpoint, which we don't call.

/** Identity claims Cloudflare Access asserted about the current session. */
export interface AccessSession {
  email?: string;
  groups?: string[];
  /** Country code of where the user authenticated from. */
  country?: string;
  /** Stable user id (per account). */
  sub?: string;
  /** Application audience (AUD) tag. */
  aud?: string;
  /** Cloudflare Access domain URL for the application. */
  iss?: string;
  /** Token expiry (Unix seconds). */
  exp?: number;
}

/** GET /api/access payload: whether JWT verification is on, plus the session. */
export interface AccessInfoPayload {
  enabled: boolean;
  aud: string | null;
  session: AccessSession | null;
}
