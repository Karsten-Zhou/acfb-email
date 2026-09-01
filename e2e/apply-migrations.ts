// Test setup: apply D1 migrations to the test database.
// Runs as a Vitest setup file (top-level statements execute before tests).
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
