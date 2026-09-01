<script setup lang="ts">
// PreferencesPanel — language dropdown (Intl-named) + theme switcher.
import { computed } from "vue";
import { t, setLocale, localeState, supportedLocales, type LocaleSetting } from "../../lib/i18n";
import { themeState, setTheme, type ThemeSetting } from "../../lib/theme";
import UiSelect from "../../components/UiSelect.vue";
import UiSwitch from "../../components/UiSwitch.vue";
import { usePushNotifications } from "../../composables/usePushNotifications";
import { Bell, Languages, Monitor, Sun, Moon } from "@lucide/vue";

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
  const label =
    new Intl.DisplayNames([navigator.language], { type: "language" }).of(navigator.language) ??
    navigator.language;
  return t("settings.languageAuto", [label]);
}

const localeOptions = computed(() => [
  { value: "auto" as LocaleSetting, label: languageLabel("auto") },
  ...supportedLocales.map((l) => ({ value: l, label: languageLabel(l) })),
]);

// --- Browser push notifications ---
const {
  state: pushState,
  status: pushStatus,
  busy: pushBusy,
  enable: enablePush,
  disable: disablePush,
} = usePushNotifications();
const pushDisabled = computed(
  () => pushBusy.value || !pushState.supported || !pushState.configured,
);
const pushStatusInfo = computed(() => {
  if (!pushState.supported) {
    return { text: t("notifications.unsupported"), cls: "text-muted-foreground" };
  }
  if (!pushState.configured) {
    return { text: t("notifications.notConfigured"), cls: "text-muted-foreground" };
  }
  switch (pushStatus.value) {
    case "subscribed":
      return { text: t("notifications.on"), cls: "text-emerald-500" };
    case "permission-denied":
      return { text: t("notifications.permissionDenied"), cls: "text-destructive" };
    default:
      return { text: t("notifications.off"), cls: "text-muted-foreground" };
  }
});
async function onPushToggle(value: boolean) {
  if (value) await enablePush();
  else await disablePush();
}
</script>

<template>
  <div class="card-surface p-4">
    <h2 class="mb-3 text-sm font-semibold">Preferences</h2>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-2">
        <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Languages class="h-3.5 w-3.5" /> {{ t("settings.language") }}
        </label>
        <UiSelect
          v-model="localeValue"
          :options="localeOptions"
          :aria-label="t('settings.language')"
        />
      </div>
      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground">{{ t("settings.theme") }}</label>
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
            <Monitor class="h-3.5 w-3.5" /> {{ t("settings.themeAuto") }}
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
            <Sun class="h-3.5 w-3.5" /> {{ t("settings.themeLight") }}
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
            <Moon class="h-3.5 w-3.5" /> {{ t("settings.themeDark") }}
          </button>
        </div>
      </div>
    </div>

    <div class="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
      <div>
        <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Bell class="h-3.5 w-3.5" /> {{ t("notifications.title") }}
        </label>
        <p class="mt-1 text-xs text-muted-foreground">{{ t("notifications.hint") }}</p>
        <p class="mt-1 text-xs" :class="pushStatusInfo.cls">{{ pushStatusInfo.text }}</p>
      </div>
      <UiSwitch
        :model-value="pushState.subscribed"
        :disabled="pushDisabled"
        :aria-label="t('notifications.title')"
        @update:model-value="onPushToggle"
      />
    </div>
  </div>
</template>
