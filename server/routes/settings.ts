// Settings routes: /api/settings
import { Hono } from "hono";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import { requireAuth } from "../auth";
import { currentUser } from "../auth/session";

export const settingsRoutes = new Hono<{ Bindings: Env }>();
settingsRoutes.use("*", requireAuth);

// GET /api/settings
settingsRoutes.get("/", async (c) => {
  const user = currentUser(c);
  const row = await c.env.DB.prepare(`SELECT data FROM app_settings WHERE user_id = ?`)
    .bind(user.id)
    .first<{ data: string }>();
  let data: unknown = {};
  if (row) {
    try {
      data = JSON.parse(row.data);
    } catch {
      data = {};
    }
  }
  return c.json({ settings: data });
});

// PUT /api/settings
settingsRoutes.put("/", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<Record<string, unknown>>();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Settings must be a JSON object");
  }
  await c.env.DB.prepare(
    `INSERT INTO app_settings (user_id, data) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`,
  )
    .bind(user.id, JSON.stringify(body))
    .run();
  return c.json({ ok: true });
});