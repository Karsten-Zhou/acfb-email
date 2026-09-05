// Optional Cloudflare Access JWT verification. When the ACCESS_JWKS and
// ACCESS_AUD secrets are set, verify each Cf-Access-Jwt-Assertion header
// (signature, issuer, audience) against the account's Access signing keys.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AccessSession } from "@shared/access";

export type { AccessSession };

/** Whether upgraded Access verification is enabled (both secrets present). */
export function isAccessVerificationEnabled(env: Env): boolean {
  return Boolean(env.ACCESS_JWKS && env.ACCESS_AUD);
}

// Cache one JWKS set per URL so signing keys are fetched once per isolate.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(jwksUrl: string) {
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

/** Verify an Access JWT and return the claims it asserts. Throws when invalid. */
export async function verifyAccessSession(env: Env, token: string): Promise<AccessSession> {
  const { ACCESS_JWKS, ACCESS_AUD } = env;
  if (!ACCESS_JWKS || !ACCESS_AUD) {
    throw new Error("Access verification is not configured");
  }
  const { payload } = await jwtVerify(token, jwksFor(ACCESS_JWKS), {
    issuer: new URL(ACCESS_JWKS).origin,
    audience: ACCESS_AUD,
  });
  return mapAccessClaims(payload);
}

/** Pick the claims we surface, normalizing unknown/absent values to undefined. */
export function mapAccessClaims(payload: JWTPayload): AccessSession {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const strs = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
  const aud = payload.aud;
  return {
    email: str(payload.email),
    groups: strs(payload.groups),
    country: str(payload.country),
    sub: str(payload.sub),
    aud: typeof aud === "string" ? aud : strs(aud)?.[0],
    iss: str(payload.iss),
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}
