import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import pluginVueI18n from "@intlify/eslint-plugin-vue-i18n";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Formatting is owned by Prettier (enforced by lefthook pre-commit), so we
// disable the vue layout/style rules that fight it. eslint-config-prettier
// already turns off exactly the conflicting set (max-attributes-per-line,
// singleline-html-element-content-newline, html-self-closing, ...), applied
// last so it wins over the recommended configs.
const vueRecommended = pluginVue.configs["flat/recommended"];

export default defineConfig(
  {
    ignores: [
      "dist/**",
      ".wrangler/**",
      "docs/.vitepress/**",
      "node_modules/**",
      "**/*.d.ts",
      ".temp/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vueRecommended.map((cfg) => ({
    ...cfg,
    rules: { ...cfg.rules, ...prettier.rules },
  })),
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      globals: globals.browser,
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.vue"],
    languageOptions: {
      globals: {
        ...globals.browser,
        __APP_VERSION__: "readonly",
        __APP_BUILD_TIME__: "readonly",
        __APP_REPO_URL__: "readonly",
      },
    },
  },
  // The root-scoped service worker (public/sw.js) is plain JS running in a
  // worker scope (`self`, `clients`, `URL`, ...), not a browser tab.
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: globals.worker,
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Email bodies are rendered with `v-html` *only* through our DOMPurify
  // sanitizer (src/lib/sanitize.ts) in the message-reading components. The
  // warning is noise for this deliberately-sanitized case; keep it enabled
  // everywhere else so new unsanitized v-html still fails CI.
  {
    files: ["src/views/parts/MessageReaderPane.vue", "src/views/MessageView.vue"],
    rules: { "vue/no-v-html": "off" },
  },
  // i18n key checks via @intlify/eslint-plugin-vue-i18n: keys used in code must
  // exist, every locale file must carry the same keys, and dead keys are
  // rejected.
  {
    plugins: {
      // TODO: Timed-out on the residual @intlify/eslint-plugin-vue-i18n
      // `defineConfig` type gap: this plugin's rules are typed as RuleModule
      // with `meta.fixable: "code" | "whitespace" | null`, which isn't
      // assignable to eslint core's RuleFixType | undefined (the `null`).
      // Closed intlify/eslint-plugin-vue-i18n#669 (fixed v4.2.0) covered only
      // the plugin `configs` types, not this `rules` typing. No open upstream
      // issue exists for the residual gap — file one against the plugin with
      // this error snippet before removing the suppression.
      // @ts-expect-error -- see TODO above; runtime-harmless, lint passes.
      "@intlify/vue-i18n": pluginVueI18n,
    },
    settings: {
      "vue-i18n": {
        localeDir: "src/locales/*.json",
        srcPath: "src",
      },
    },
    rules: {
      "@intlify/vue-i18n/no-missing-keys": "error",
      "@intlify/vue-i18n/no-missing-keys-in-other-locales": "error",
      "@intlify/vue-i18n/no-duplicate-keys-in-locale": "error",
      "@intlify/vue-i18n/no-unused-keys": [
        "error",
        {
          src: "./src",
          extensions: [".js", ".ts", ".vue"],
        },
      ],
    },
  },
  prettier,
);
