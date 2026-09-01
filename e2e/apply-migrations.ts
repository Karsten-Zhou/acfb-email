// Test setup: apply D1 migrations to the test database.
// Runs as a Vitest setup file (top-level statements execute before tests).
// @ts-expect-error -- runtime-only module provided by the Cloudflare vitest pool (no static types)
import { applyD1Migrations } from "cloudflare:test";
// @ts-expect-error -- runtime-only module provided by the Cloudflare vitest pool (no static types)
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
