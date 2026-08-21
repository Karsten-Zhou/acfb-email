// Minimal i18n for the client (en / de / zh) with an 'auto' (browser) option.
// Exported as a reactive singleton so views can switch live.
//
// Translation content lives in JSON files (src/locales/*.json); this module
// only wires them up. Adding a new locale = add a JSON file + extend the
// types below (the union lists are compile-time checked by t()).

import { reactive, computed } from "vue";
import en from "../locales/en.json";
import de from "../locales/de.json";
import zh from "../locales/zh.json";

export type Locale = "en" | "de" | "zh";
export type LocaleSetting = "auto" | Locale;

export const supportedLocales: Locale[] = ["en", "de", "zh"];

function detectBrowser(): Locale {
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  const lang = nav.toLowerCase();
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

export const dict = {
  en,
  de,
  zh,
} as const;

export type MessageKey = keyof typeof en;

const state = reactive<{
  setting: LocaleSetting;
  locale: Locale;
}>({
  setting: "auto",
  locale: detectBrowser(),
});

/** Set the locale preference ("auto" resolves by browser). */
export function setLocale(setting: LocaleSetting) {
  state.setting = setting;
  state.locale = setting === "auto" ? detectBrowser() : setting;
  localStorage.setItem("ec_locale", setting);
  document.documentElement.lang = state.locale;
}

/** Restore the user's saved preference (or auto) on boot. */
export function initLocale() {
  const saved = (localStorage.getItem("ec_locale") ?? "auto") as LocaleSetting;
  setLocale(saved);
}

export const localeState = computed(() => state);

type Dict = { [K in MessageKey]: string };

function getDict(): Dict {
  return (dict[state.locale] ?? dict.en) as unknown as Dict;
}

/** Translate a key with optional interpolation ({name}). */
export function t(key: MessageKey, params?: Record<string, string>): string {
  let s: string = getDict()[key] ?? dict.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}