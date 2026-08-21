// Theme store: light / dark / auto (follows system), persisted.
import { reactive } from "vue";

export type ThemeSetting = "light" | "dark" | "auto";
export type Theme = "light" | "dark";

const state = reactive<{ setting: ThemeSetting; theme: Theme }>({
  setting: "auto",
  theme: "light",
});

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(setting: ThemeSetting): Theme {
  return setting === "auto" ? systemTheme() : setting;
}

/** Apply the theme to the document (adds/removes `.dark`). */
export function applyTheme() {
  state.theme = resolve(state.setting);
  document.documentElement.classList.toggle("dark", state.theme === "dark");
}

export function setTheme(setting: ThemeSetting) {
  state.setting = setting;
  localStorage.setItem("ec_theme", setting);
  applyTheme();
}

export function initTheme() {
  const saved = (localStorage.getItem("ec_theme") ?? "auto") as ThemeSetting;
  state.setting = saved;
  applyTheme();
  // React to system changes while in auto mode.
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener?.("change", () => {
      if (state.setting === "auto") applyTheme();
    });
}

export { state as themeState };