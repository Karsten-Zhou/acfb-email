// Settings routes: /api/settings
import { Hono } from "hono";
import { HttpError } from "../http-error";
import type { Env } from "../env";

export const settingsRoutes = new Hono<{ Bindings: Env }>();

// GET /api/settings
settingsRoutes.get("/", async (c) => {
  const row = await c.env.DB.prepare(`SELECT data FROM app_settings WHERE id = 1`).first<{
    data: string;
  }>();
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
  const body = await c.req.json<Record<string, unknown>>();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Settings must be a JSON object");
  }
  await c.env.DB.prepare(
    `INSERT INTO app_settings (id, data) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  )
    .bind(JSON.stringify(body))
    .run();
  return c.json({ ok: true });
});
