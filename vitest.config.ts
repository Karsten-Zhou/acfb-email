import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

const migrationsPath = fileURLToPath(new URL("./migrations", import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(migrationsPath);
      return {
        wrangler: {
          configPath: "./wrangler.jsonc",
          environment: "production",
        },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      };
    }),
  ],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@server": fileURLToPath(new URL("./server", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    setupFiles: ["./e2e/apply-migrations.ts"],
  },
});