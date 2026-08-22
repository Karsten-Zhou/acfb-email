// Authentication: GitHub OAuth web flow + server-side sessions + allowlist.
//
// Session model:
//   - After OAuth callback, create a random opaque token.
//   - Store a SHA-256 hash of it in D1 sessions table (never store raw token
//     in DB — a DB leak would not grant sessions).
//   - Set it as a HttpOnly, Secure (prod), SameSite=Lax cookie.
//   - Client sends it on every request; we hash & look up.
//
// CSRF:
//   - The OAuth start redirect includes a state param (random, tied to cookie)
//     which must match on callback; prevents login CSRF.
//   - State is stored in a short-lived cookie "ec_state" (httpOnly, sameSite).
//   - For API mutations, clients must send the matching csrf cookie value in
//     header x-csrf-token. We verify with constant-time compare.

import { randomUUID } from "crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "@shared/constants";

export const SESSION_DAYS_DEFAULT = 7;
const GITHUB_USER_ENDPOINT = "https://api.github.com/user";

export interface SessionUser {
  id: string;
  githubId: number;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// ---------------------------------------------------------------
// GitHub OAuth
// ---------------------------------------------------------------

export function buildAuthorizeUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/api/auth/callback`,
    scope: "read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(env: Env, code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_URL}/api/auth/callback`,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new HttpError(401, "GitHub did not return an access token");
  }
  return data.access_token;
}

export async function fetchGitHubUser(token: string): Promise<{
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}> {
  const res = await fetch(GITHUB_USER_ENDPOINT, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "cloudflare-email-client" },
  });
  if (!res.ok) throw new HttpError(401, "GitHub user lookup failed");
  const data = (await res.json()) as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string | null;
  };
  return {
    id: data.id,
    login: data.login,
    name: data.name ?? null,
    avatar_url: data.avatar_url ?? null,
  };
}

export function isAllowedUser(env: Env, githubId: number): boolean {
  const allowed = env.ALLOWED_GITHUB_USER_ID?.trim();
  if (!allowed) return false;
  return String(githubId) === allowed;
}

// ---------------------------------------------------------------
// Session management
// ---------------------------------------------------------------

export async function hashToken(token: string): Promise<string> {
  // Web Crypto SHA-256 hex.
  return sha256Hex(token);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sessionExpiry(env: Env): Date {
  const days = parseInt(env.SESSION_DAYS ?? "", 10);
  const d = Number.isFinite(days) && days > 0 ? days : SESSION_DAYS_DEFAULT;
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const hashed = await sha256Hex(token);
  const exp = sessionExpiry(env);
  await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(hashed, userId, exp.toISOString())
    .run();
  return token;
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  if (!token) return;
  await env.DB.prepare(`UPDATE sessions SET revoked = 1 WHERE id = ?`)
    .bind(await sha256Hex(token))
    .run();
}

export async function sessionUser(env: Env, token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.id, u.id AS user_id, u.github_id, u.github_login, u.display_name, u.avatar_url
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.revoked = 0 AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<{
      user_id: string;
      github_id: number;
      github_login: string;
      display_name: string | null;
      avatar_url: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.user_id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

export async function upsertUser(
  env: Env,
  gh: { id: number; login: string; name: string | null; avatar_url: string | null },
): Promise<string> {
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE github_id = ?`)
    .bind(gh.id)
    .first<{ id: string }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE users SET github_login = ?, display_name = ?, avatar_url = ? WHERE id = ?`,
    )
      .bind(gh.login, gh.name, gh.avatar_url, existing.id)
      .run();
    return existing.id;
  }
  const id = randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, github_id, github_login, display_name, avatar_url)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, gh.id, gh.login, gh.name, gh.avatar_url)
    .run();
  await env.DB.prepare(`INSERT INTO app_settings (user_id, data) VALUES (?, '{}')`).bind(id).run();
  return id;
}

// ---------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------

export function setSessionCookie(c: Context<{ Bindings: Env }>, token: string): void {
  const exp = sessionExpiry(c.env);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(c.env),
    sameSite: "Lax",
    path: "/",
    expires: exp,
  });
}

export function clearSessionCookie(c: Context<{ Bindings: Env }>): void {
  setCookie(c, SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProd(c.env),
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

export function setStateCookie(c: Context<{ Bindings: Env }>, state: string): void {
  setCookie(c, "ec_state", state, {
    httpOnly: true,
    secure: isProd(c.env),
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: 600, // 10 min
  });
}

export function setCsrfCookie(c: Context<{ Bindings: Env }>): void {
  const token = randomToken();
  setCookie(c, CSRF_COOKIE, token, {
    httpOnly: false, // client must read it to send back as header
    secure: isProd(c.env),
    sameSite: "Strict",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
}

export function isProd(env: Env): boolean {
  return env.APP_URL?.startsWith("https://") ?? false;
}

export async function safeEqual(a: string | undefined, b: string | undefined): Promise<boolean> {
  // Constant-time compare via HMAC-free byte xor over UTF-8 encodings.
  if (!a || !b) return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// ---------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------

export type AuthedContext = Context<{ Bindings: Env }> & { user: SessionUser };

/** Require a valid session. Attaches `user` to context. */
export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE) ?? "";
  const user = await sessionUser(c.env, token);
  if (!user) throw new HttpError(401, "Not signed in");
  // hold user on context
  (c as AuthedContext).user = user;
  await next();
};

/** Validate the CSRF header against the cookie for mutation requests. */
export async function verifyCsrf(c: Context<{ Bindings: Env }>): Promise<void> {
  const cookie = getCookie(c, CSRF_COOKIE);
  const header = c.req.header(CSRF_HEADER);
  if (!safeEqual(cookie, header)) {
    throw new HttpError(403, "Invalid or missing CSRF token");
  }
}

/** Middleware that enforces CSRF on non-GET/HEAD. */
export const csrfGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    await verifyCsrf(c);
  }
  await next();
};
