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

// Recursive dotted-path type over the (nested) en locale: yields strings like
// "common.settings" / "accounts.testConnection" that t() resolves via deepGet.
type Paths<T, P extends string = ""> = {
  [K in keyof T]: T[K] extends string
    ? P extends ""
      ? `${K & string}`
      : `${P}.${K & string}`
    : Paths<T[K], P extends "" ? `${K & string}` : `${P}.${K & string}`>;
}[keyof T];

export type MessageKey = Paths<typeof en>;

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

/** Look up a (possibly dotted) path in a nested dictionary object. */
function deepGet<O>(obj: O, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => {
    if (o && typeof o === "object") return (o as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

/** Translate a key with optional interpolation ({name}). */
export function t(key: MessageKey, params?: Record<string, string>): string {
  const current = dict[state.locale] ?? dict.en;
  let s =
    (deepGet(current, key) as string | undefined) ??
    (deepGet(dict.en, key) as string | undefined) ??
    key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

// ---------------------------------------------------------------
// Account sync error codes. The server stores a stable code in the
// account's state_message; translate it here (raw provider detail passes
// through unchanged).
// ---------------------------------------------------------------
const SYNC_ERROR_KEYS = new Set<MessageKey>([
  "accounts.errOauthRequired",
  "accounts.errAuth",
  "accounts.errNetwork",
  "accounts.errTimeout",
  "accounts.errSyncFailed",
]);

/** Translate a server-stored sync error code; pass through raw detail. */
export function syncErrorLabel(codeOrMessage: string): string {
  const key = codeOrMessage as MessageKey;
  return SYNC_ERROR_KEYS.has(key) ? t(key) : codeOrMessage;
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
