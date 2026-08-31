import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    cloudflare({
      // Fully-local dev: do not try to fetch account metadata from the
      // Cloudflare API (avoids proxy-related timeouts in local miniflare).
      remoteBindings: false,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@server": fileURLToPath(new URL("./server", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    // The @vitejs/plugin-vue HMR integration with the Cloudflare plugin can
    // trigger a false-positive dev overlay on file edits; disable the overlay.
    hmr: { overlay: false },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_REPO_URL__: JSON.stringify(pkg.homepage),
  },
  test: {
    // Vitest config for the workers pool is defined in vitest.config.ts
  },
});
