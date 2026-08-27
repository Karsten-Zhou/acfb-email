<script setup lang="ts">
// PreferencesPanel — language dropdown (Intl-named) + theme switcher.
import { computed } from "vue";
import { t, setLocale, localeState, supportedLocales, type LocaleSetting } from "../../lib/i18n";
import { themeState, setTheme, type ThemeSetting } from "../../lib/theme";
import UiSelect from "../../components/UiSelect.vue";
import { Languages, Monitor, Sun, Moon } from "lucide-vue-next";

const localeValue = computed({
  get: () => localeState.value.setting,
  set: (v: LocaleSetting) => setLocale(v),
});
const themeValue = computed({
  get: () => themeState.setting,
  set: (v: ThemeSetting) => setTheme(v),
});

function languageLabel(lang: LocaleSetting): string {
  if (lang !== "auto") {
    return new Intl.DisplayNames([lang], { type: "language" }).of(lang) ?? lang;
  }
  return t("languageAuto", {
    0:
      new Intl.DisplayNames([navigator.language], { type: "language" }).of(navigator.language) ??
      navigator.language,
  });
}

const localeOptions = computed(() => [
  { value: "auto" as LocaleSetting, label: languageLabel("auto") },
  ...supportedLocales.map((l) => ({ value: l, label: languageLabel(l) })),
]);
</script>

<template>
  <div class="card-surface p-4">
    <h2 class="mb-3 text-sm font-semibold">Preferences</h2>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-2">
        <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Languages class="h-3.5 w-3.5" /> {{ t("language") }}
        </label>
        <UiSelect v-model="localeValue" :options="localeOptions" :aria-label="t('language')" />
      </div>
      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground">{{ t("theme") }}</label>
        <div class="flex gap-1.5">
          <button
            class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
            :class="
              themeValue === 'auto'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-accent'
            "
            @click="themeValue = 'auto'"
          >
            <Monitor class="h-3.5 w-3.5" /> {{ t("themeAuto") }}
          </button>
          <button
            class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
            :class="
              themeValue === 'light'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-accent'
            "
            @click="themeValue = 'light'"
          >
            <Sun class="h-3.5 w-3.5" /> {{ t("themeLight") }}
          </button>
          <button
            class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
            :class="
              themeValue === 'dark'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-accent'
            "
            @click="themeValue = 'dark'"
          >
            <Moon class="h-3.5 w-3.5" /> {{ t("themeDark") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
