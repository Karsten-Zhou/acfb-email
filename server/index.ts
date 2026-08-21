// Worker entrypoint: Hono app mounted on /api, with SPA fallback handled by
// Workers Assets (wrangler config: not_found_handling = single-page-application).

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { HttpError } from "./http-error";
import { csrfGuard } from "./auth";
import { authRoutes } from "./routes/auth";
import { accountRoutes } from "./routes/accounts";
import { oauthRoutes } from "./routes/oauth";
import { mailboxRoutes } from "./routes/mailboxes";
import { messageRoutes } from "./routes/messages";
import { sendRoutes } from "./routes/send";
import { settingsRoutes } from "./routes/settings";

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

// ----- global middleware -----
app.use("*", logger());
app.use("/api/*", cors({ origin: "*", allowHeaders: ["Content-Type", "x-csrf-token"], allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] }));
app.use("/api/*", csrfGuard);

// ----- api routes -----
const api = new Hono<AppEnv>();
api.route("/auth", authRoutes);
api.route("/oauth", oauthRoutes);
api.route("/accounts", accountRoutes);
api.route("/mailboxes", mailboxRoutes);
api.route("/messages", messageRoutes);
api.route("/send", sendRoutes);
api.route("/settings", settingsRoutes);

app.route("/api", api);

// Health check (unauthenticated)
// Reports OAuth config status only (for disabling Connect buttons). Version
// and build metadata are static strings injected at build time by the SPA
// (vite define), so they live in the frontend, not here.
app.get("/api/health", (c) => {
  const env = c.env;
  return c.json({
    ok: true,
    config: {
      gmailOauth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      outlookOauth: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
      githubOauth: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    },
  });
});

// 404 for unknown /api paths
app.notFound((c) => {
  if (c.req.path.startsWith("/api")) {
    return c.json({ error: "Not found" }, 404);
  }
  // Assets SPA fallback handles non-API routes.
  return c.text("Not found", 404);
});

// ----- error handler -----
app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.publicMessage, code: err.code }, err.status);
  }
  // Log the real error (safe: no credentials should reach here).
  console.error("[error]", c.req.method, c.req.path, err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;