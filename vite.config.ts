import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath, URL } from "node:url";

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
  test: {
    // Vitest config for the workers pool is defined in vitest.config.ts
  },
});
