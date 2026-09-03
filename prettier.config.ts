import { type Config } from "prettier";

/**
 * @see https://prettier.io/docs/configuration
 */
export default {
  semi: true,
  singleQuote: false,
  printWidth: 100,
  tabWidth: 2,
  trailingComma: "all",
  vueIndentScriptAndStyle: false,
} satisfies Config;
