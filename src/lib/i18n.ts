// i18n for the client (en / de / zh) with an 'auto' (browser) option.
// Exported as a reactive singleton so views can switch live.
//
// Backed by vue-i18n (Composition API). `en` is the master message schema and
// `MessageKey` is a recursive dotted-path type over it, so t() keys are
// compile-time checked (a mistyped key fails typecheck). Key consistency across
// locale files and unused keys are enforced by @intlify/eslint-plugin-vue-i18n
// in `bun run lint`. Adding a new locale = add a JSON file + extend the types.

import { match } from "@formatjs/intl-localematcher";
import { createI18n } from "vue-i18n";
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

// Recursive dotted-path type over the (nested) en locale: yields strings like
// "common.settings" / "accounts.testConnection".
type Paths<T, P extends string = ""> = {
  [K in keyof T]: T[K] extends string
    ? P extends ""
      ? `${K & string}`
      : `${P}.${K & string}`
    : Paths<T[K], P extends "" ? `${K & string}` : `${P}.${K & string}`>;
}[keyof T];

export type MessageKey = Paths<typeof en>;

// vue-i18n instance (Composition API). missing/fallback warnings are off: a
// missing key falls back to `en`, then to the raw key (matching the previous
// hand-rolled behaviour); correctness is enforced by typecheck + lint instead.
const i18n = createI18n({
  legacy: false,
  locale: resolveAutoLocale(),
  fallbackLocale: "en",
  messages: { en, de, zh },
  missingWarn: false,
  fallbackWarn: false,
});

const state = reactive<{
  setting: LocaleSetting;
  locale: Locale;
}>({
  setting: "auto",
  locale: resolveAutoLocale(),
});

export const localeState = computed(() => state);

/** Set the locale preference ("auto" resolves by browser). */
export function setLocale(setting: LocaleSetting) {
  state.setting = setting;
  state.locale = setting === "auto" ? resolveAutoLocale() : setting;
  i18n.global.locale.value = state.locale;
  localStorage.setItem("ec_locale", setting);
  document.documentElement.lang = state.locale;
}

/** Restore the user's saved preference (or auto) on boot. */
export function initLocale() {
  const saved = (localStorage.getItem("ec_locale") ?? "auto") as LocaleSetting;
  setLocale(saved);
}

/**
 * Translate a (compile-time checked) key. Params may be named (Record, for
 * {name} placeholders) or a list (Array, for positional {0}/{1} placeholders).
 */
export function t(
  key: MessageKey,
  params?: Record<string, string | number> | Array<string | number>,
): string {
  return (
    Array.isArray(params) ? i18n.global.t(key, params) : i18n.global.t(key, params ?? {})
  ) as string;
}

// ---------------------------------------------------------------
// Account sync error codes. The server stores a stable code in the
// account's state_message; translate it here (raw provider detail passes
// through unchanged).
// ---------------------------------------------------------------

/** Translate a server-stored sync error code; pass through raw detail. */
export function syncErrorLabel(codeOrMessage: string): string {
  switch (codeOrMessage) {
    case "errOauthRequired":
      return t("accounts.errOauthRequired");
    case "errAuth":
      return t("accounts.errAuth");
    case "errNetwork":
      return t("accounts.errNetwork");
    case "errTimeout":
      return t("accounts.errTimeout");
    case "errSyncFailed":
      return t("accounts.errSyncFailed");
    default:
      return codeOrMessage;
  }
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
