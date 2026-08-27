// Worker entrypoint: Hono app mounted on /api, with SPA fallback handled by
// Workers Assets (wrangler config: not_found_handling = single-page-application).

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, SyncMessage } from "./env";
import { syncAccount } from "./sync/sync-service";
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
// Request logger with wall-clock timestamps (for debugging sync/poll timings).
app.use("*", async (c, next) => {
  const started = Date.now();
  await next();
  const ms = Date.now() - started;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`${ts} ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
});
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "x-csrf-token"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }),
);
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
  // The app is behind a GitHub login, so surface the underlying error detail
  // to help debugging instead of a generic 500 (no credentials reach here).
  const message = err instanceof Error ? err.message : "Internal server error";
  return c.json({ error: message }, 500);
});

// Queue consumer: runs full account syncs in the background. A queue batch gets
// 15 minutes of wall-time (vs waitUntil's 30 s), which a slow multi-mailbox
// IMAP sync needs. syncAccount persists the account state; errors are acked
// (no infinite retries) and surfaced through the account's state_message.
export async function queue(batch: MessageBatch<SyncMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const { accountId } = msg.body;
    try {
      await syncAccount(env, accountId);
    } catch (err) {
      console.error("[queue] sync failed for account", accountId, err);
    }
  }
}

export default app;
