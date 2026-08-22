<script setup lang="ts">
// PreferencesPanel — language dropdown (Intl-named) + theme switcher.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { t, setLocale, localeState, supportedLocales, type LocaleSetting } from "../../lib/i18n";
import { themeState, setTheme, type ThemeSetting } from "../../lib/theme";
import UiToolTip from "../../components/UiToolTip.vue";
import { Languages, ChevronDown, Check, Monitor, Sun, Moon } from "lucide-vue-next";

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
const languageMenuOpen = ref(false);
const languageMenuRef = ref<HTMLElement | null>(null);

function toggleLanguageMenu() {
  languageMenuOpen.value = !languageMenuOpen.value;
}
function pickLanguage(v: LocaleSetting) {
  setLocale(v);
  languageMenuOpen.value = false;
}
/* Close the language dropdown on outside click. */
function onDocClick(e: MouseEvent) {
  if (languageMenuRef.value && !languageMenuRef.value.contains(e.target as Node)) {
    languageMenuOpen.value = false;
  }
}
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div class="card-surface p-4">
    <h2 class="mb-3 text-sm font-semibold">Preferences</h2>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-2">
        <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Languages class="h-3.5 w-3.5" /> {{ t("language") }}
        </label>
        <!-- Nice language dropdown (Intl-named options) -->
        <div ref="languageMenuRef" class="relative">
          <button
            type="button"
            class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 text-sm"
            @click.stop="toggleLanguageMenu"
          >
            <span>{{ languageLabel(localeValue) }}</span>
            <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <Transition
            enter-active-class="transition-opacity duration-100"
            leave-active-class="transition-opacity duration-75"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <div
              v-if="languageMenuOpen"
              class="absolute top-full left-0 z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md"
            >
              <button
                class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                :class="localeValue === 'auto' ? 'bg-accent text-accent-foreground' : ''"
                @click="pickLanguage('auto')"
              >
                <span>{{ languageLabel("auto") }}</span>
                <Check v-if="localeValue === 'auto'" class="h-4 w-4 text-primary" />
              </button>
              <button
                v-for="l in supportedLocales"
                :key="l"
                class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                :class="localeValue === l ? 'bg-accent text-accent-foreground' : ''"
                @click="pickLanguage(l)"
              >
                <span>{{ languageLabel(l) }}</span>
                <Check v-if="localeValue === l" class="h-4 w-4 text-primary" />
              </button>
            </div>
          </Transition>
        </div>
      </div>
      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground">{{ t("theme") }}</label>
        <div class="flex gap-1.5">
          <UiToolTip :label="t('themeAuto')">
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
          </UiToolTip>
          <UiToolTip :label="t('themeLight')">
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
          </UiToolTip>
          <UiToolTip :label="t('themeDark')">
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
          </UiToolTip>
        </div>
      </div>
    </div>
  </div>
</template>
