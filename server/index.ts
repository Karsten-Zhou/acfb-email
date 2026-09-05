// Worker entrypoint: Hono app mounted on /api, with SPA fallback handled by
// Workers Assets (wrangler config: not_found_handling = single-page-application).

import process from "node:process";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { enqueueEligibleSyncs, syncAccount, syncMailbox, type SyncMode } from "./sync/sync-service";

// Payload for account-sync jobs: no mailboxId = whole account (mode "check" =
// inbox-only); mailboxId = single-mailbox retry.
interface SyncMessage {
  accountId: string;
  mailboxId?: string;
  mode?: SyncMode;
}
import { markAccountSyncSucceeded } from "./sync/sync-persistence";
import { HttpError } from "./http-error";
import { accountRoutes } from "./routes/accounts";
import { oauthRoutes } from "./routes/oauth";
import { mailboxRoutes } from "./routes/mailboxes";
import { messageRoutes } from "./routes/messages";
import { sendRoutes } from "./routes/send";
import { settingsRoutes } from "./routes/settings";
import { pushRoutes } from "./routes/push";
import { accessRoutes } from "./routes/access";
import { isAccessVerificationEnabled, verifyAccessSession, type AccessSession } from "./access";

type AppEnv = {
  Bindings: Env;
  Variables: { accessSession?: AccessSession };
};

/** Verbose logs in dev, or in prod when PRODUCTION_DEBUG is "true". */
function isDebug(env: Env): boolean {
  return process.env.NODE_ENV !== "production" || String(env.PRODUCTION_DEBUG) === "true";
}

function debugLog(env: Env, ...args: unknown[]): void {
  if (isDebug(env)) console.log("[debug]", ...args);
}

const app = new Hono<AppEnv>();

// ----- global middleware -----
// Request logger (dev, or production when PRODUCTION_DEBUG is enabled).
app.use("*", async (c, next) => {
  if (!isDebug(c.env)) return next();
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
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }),
);

// Cloudflare Access gates the app at the edge. This fail-safe refuses API
// requests when Access isn't running, so an accidental dashboard disable can't
// silently open the API. Access adds the Cf-Access-Jwt-Assertion header to
// approved requests in production; local dev supplies ctx.access via the
// `access.dev` block in wrangler.jsonc.
app.use("/api/*", async (c, next) => {
  const executionCtx = c.executionCtx as { access?: unknown } | undefined;
  const token = c.req.header("cf-access-jwt-assertion");
  const throughAccess = Boolean(executionCtx?.access) || Boolean(token);
  if (!throughAccess) {
    return c.json({ error: "Access required", code: "access_required" }, 403);
  }
  // Optional hardening: verify the Access JWT when the ACCESS_* secrets are set.
  if (isAccessVerificationEnabled(c.env) && !executionCtx?.access && token) {
    try {
      c.set("accessSession", await verifyAccessSession(c.env, token));
    } catch {
      return c.json({ error: "Invalid Access session", code: "access_invalid" }, 403);
    }
  }
  await next();
});

// ----- api routes -----
const api = new Hono<AppEnv>();
api.route("/oauth", oauthRoutes);
api.route("/accounts", accountRoutes);
api.route("/mailboxes", mailboxRoutes);
api.route("/messages", messageRoutes);
api.route("/send", sendRoutes);
api.route("/settings", settingsRoutes);
api.route("/push", pushRoutes);
api.route("/access", accessRoutes);

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
  // The app is behind Cloudflare Access, so surface the underlying error
  // detail to help debugging instead of a generic 500 (no credentials reach
  // here).
  const message = err instanceof Error ? err.message : "Internal server error";
  return c.json({ error: message }, 500);
});

// Queue consumer: a bare accountId syncs the whole account (or inbox folders
// in "check" mode); a mailboxId retries one mailbox. Errors ack and surface
// via the account's state_message / the mailbox's sync_state.
async function handleQueue(batch: MessageBatch<SyncMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const { accountId, mailboxId, mode } = msg.body;
    const t0 = Date.now();
    try {
      if (mailboxId) {
        await syncMailbox(env, accountId, mailboxId);
        await markAccountSyncSucceeded(env, accountId);
        debugLog(
          env,
          `queue mailbox done acct=${accountId} mailbox=${mailboxId} ms=${Date.now() - t0}`,
        );
      } else {
        const r = await syncAccount(env, accountId, { mode });
        debugLog(
          env,
          `queue done acct=${accountId} mode=${mode} ms=${Date.now() - t0} boxes=${r.mailboxesSynced} seen=${r.messagesSeen}${r.timedOut ? " timedOut" : ""}`,
        );
      }
    } catch (err) {
      console.error("[queue] sync failed for account", accountId, mailboxId ?? "", err);
    }
  }
}

// Cron: enqueue an inbox check per enabled account (the lease drops dups).
async function handleScheduled(_controller: ScheduledController, env: Env): Promise<void> {
  try {
    const enqueued = await enqueueEligibleSyncs(env, "check");
    debugLog(env, `cron enqueued checks=${enqueued.length}`);
  } catch (err) {
    console.error("[cron] check run failed", err);
  }
}

// The Cloudflare Vite plugin only registers queue consumers exposed on the
// default export object (alongside `fetch`); a standalone named `queue` export
// is not detected as a queue handler and the consumer attach fails.
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  queue: handleQueue,
  scheduled: handleScheduled,
};
