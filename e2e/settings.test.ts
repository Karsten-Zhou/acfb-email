// Settings routes: /api/settings (pure D1, no network).
import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { apiJson, clearDb } from "./helpers";

const jsonHeaders = { "content-type": "application/json" } as const;

describe("settings routes", () => {
  beforeEach(() => clearDb(env));

  it("returns an empty object when no settings row exists", async () => {
    const { status, body } = await apiJson<{ settings: Record<string, unknown> }>("/api/settings");
    expect(status).toBe(200);
    expect(body.settings).toEqual({});
  });

  it("returns the parsed settings when a row exists", async () => {
    await env.DB.prepare("INSERT INTO app_settings (id, data) VALUES (1, ?)")
      .bind('{"theme":"dark","locale":"zh"}')
      .run();
    const { status, body } = await apiJson<{ settings: Record<string, unknown> }>("/api/settings");
    expect(status).toBe(200);
    expect(body.settings).toEqual({ theme: "dark", locale: "zh" });
  });

  it("returns {} when the stored data is invalid JSON", async () => {
    await env.DB.prepare("INSERT INTO app_settings (id, data) VALUES (1, ?)")
      .bind("not-json")
      .run();
    const { status, body } = await apiJson<{ settings: Record<string, unknown> }>("/api/settings");
    expect(status).toBe(200);
    expect(body.settings).toEqual({});
  });

  it("PUT stores the object and GET returns it back", async () => {
    const payload = { theme: "dark", locale: "zh" };
    const put = await apiJson<{ ok: boolean }>("/api/settings", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ok: true });

    const get = await apiJson<{ settings: Record<string, unknown> }>("/api/settings");
    expect(get.body.settings).toEqual(payload);
  });

  it("round-trips nested values", async () => {
    const payload = { a: 1, b: { c: true } };
    await apiJson("/api/settings", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    const { status, body } = await apiJson<{ settings: unknown }>("/api/settings");
    expect(status).toBe(200);
    expect(body.settings).toEqual({ a: 1, b: { c: true } });
  });

  it("PUT overwrites the previous settings", async () => {
    await apiJson("/api/settings", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ a: 1 }),
    });
    await apiJson("/api/settings", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ b: 2 }),
    });
    const { body } = await apiJson<{ settings: unknown }>("/api/settings");
    expect(body.settings).toEqual({ b: 2 });
  });

  it.each([
    ["an array", "[]"],
    ["null", "null"],
    ["a string", '"hello"'],
    ["a number", "42"],
  ])("PUT returns 400 when the body is %s", async (_label, raw) => {
    const { status, body } = await apiJson<{ error?: unknown; code?: unknown }>("/api/settings", {
      method: "PUT",
      headers: jsonHeaders,
      body: raw,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Settings must be a JSON object");
    expect(typeof body.code).toBe("string");
  });
});
