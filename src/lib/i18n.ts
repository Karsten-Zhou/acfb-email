// Minimal i18n for the client (en / de / zh) with an 'auto' (browser) option.
// Exported as a reactive singleton so views can switch live.
//
// Translation content lives in JSON files (src/locales/*.json); this module
// only wires them up. Adding a new locale = add a JSON file + extend the
// types below (the union lists are compile-time checked by t()).

import { match } from "@formatjs/intl-localematcher";
import { reactive, computed } from "vue";
import en from "../locales/en.json";
import de from "../locales/de.json";
import zh from "../locales/zh.json";

export type Locale = "en" | "de" | "zh";
export type LocaleSetting = "auto" | Locale;

export const supportedLocales: Locale[] = ["en", "de", "zh"];

function resolveAutoLocale(): Locale {
  return match(navigator.languages, supportedLocales, "en") as Locale;
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
  locale: resolveAutoLocale(),
});

/** Set the locale preference ("auto" resolves by browser). */
export function setLocale(setting: LocaleSetting) {
  state.setting = setting;
  state.locale = setting === "auto" ? resolveAutoLocale() : setting;
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

// ---------------------------------------------------------------
// Locale-aware date/time formatting.
// Uses the *selected* app locale (not the browser/os default) so dates
// follow the language set in Settings. `localeState.value.locale` is
// reactive, so views re-format automatically when the language changes.
// ---------------------------------------------------------------

/** The BCP-47 tag actually in effect for the current app locale. */
export function currentLocaleTag(): string {
  return localeState.value.locale;
}

function timeTag(): string {
  const tag = currentLocaleTag();
  if (tag === "zh") return "zh-CN";
  if (tag === "de") return "de-DE";
  return "en-US";
}

/** Date only, e.g. "Aug 22" / "22. Aug." / "8月22日" per selected language. */
export function formatDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(timeTag(), { month: "short", day: "numeric" }).format(d);
}

/** Relative short stamp: time-of-day for today, date otherwise. */
export function formatRelativeDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(timeTag(), { hour: "2-digit", minute: "2-digit" }).format(d);
  }
  const sameYear = d.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat(timeTag(), {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/** Full date + time, e.g. for the reading pane / build time. */
export function formatDateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(timeTag(), { dateStyle: "medium", timeStyle: "short" }).format(d);
}
