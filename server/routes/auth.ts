// Authentication routes: /api/auth/*
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import {
  buildAuthorizeUrl,
  clearSessionCookie,
  createSession,
  deleteSession,
  exchangeCodeForToken,
  fetchGitHubUser,
  isAllowedUser,
  randomToken,
  safeEqual,
  sessionUser,
  setSessionCookie,
  setStateCookie,
  setCsrfCookie,
  upsertUser,
} from "../auth";
import { SESSION_COOKIE } from "@shared/constants";

export const authRoutes = new Hono<{ Bindings: Env }>();

// GET /api/auth/login -> redirect to GitHub
authRoutes.get("/login", (c) => {
  const state = randomToken();
  setStateCookie(c, state);
  const url = buildAuthorizeUrl(c.env, state);
  return c.redirect(url);
});

// GET /api/auth/callback?code=...&state=...
authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  if (!code) throw new HttpError(400, "Missing authorization code");
  const expectedState = getCookie(c, "ec_state") ?? "";
  if (!(await safeEqual(expectedState, state))) {
    throw new HttpError(400, "Invalid OAuth state");
  }
  // clear state cookie
  setCookie(c, "ec_state", "", { maxAge: 0, path: "/api/auth" });

  const token = await exchangeCodeForToken(c.env, code);
  const gh = await fetchGitHubUser(token);
  if (!isAllowedUser(c.env, gh.id)) {
    throw new HttpError(403, "This GitHub account is not allowed to use this application.");
  }
  const userId = await upsertUser(c.env, gh);
  const sessionToken = await createSession(c.env, userId);
  setSessionCookie(c, sessionToken);
  setCsrfCookie(c);
  return c.redirect(`${c.env.APP_URL}/#/mail`);
});

// GET /api/auth/me -> current user (or 401)
authRoutes.get("/me", async (c) => {
  const token = getCookie(c, SESSION_COOKIE) ?? "";
  const user = await sessionUser(c.env, token);
  if (!user) throw new HttpError(401, "Not signed in");
  return c.json({ user });
});

// POST /api/auth/logout
authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE) ?? "";
  await deleteSession(c.env, token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
