import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Formatting is owned by Prettier (enforced by lefthook pre-commit), so we
// disable the vue layout/style rules that fight it. eslint-config-prettier
// already turns off exactly the conflicting set (max-attributes-per-line,
// singleline-html-element-content-newline, html-self-closing, ...), applied
// last so it wins over the recommended configs.
const vueRecommended = pluginVue.configs["flat/recommended"];

export default tseslint.config(
  { ignores: ["dist/**", ".wrangler/**", "node_modules/**", "**/*.d.ts"] },
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
      },
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
  prettier,
);
