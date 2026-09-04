<script setup lang="ts">
// Auto-check cadence: how often the open app looks for new mail. Rendered as a
// section of the Preferences panel (see PreferencesPanel.vue).
import { computed } from "vue";
import { t } from "../../lib/i18n";
import {
  SYNC_CADENCE_OPTIONS,
  setActiveCadence,
  setInactiveCadence,
  syncPrefs,
  type SyncCadence,
} from "../../lib/syncPrefs";
import UiSelect from "../../components/UiSelect.vue";
import { RefreshCw } from "@lucide/vue";

const cadenceOptions = computed(() =>
  SYNC_CADENCE_OPTIONS.map((m) => ({
    value: String(m),
    label: m === 0 ? t("settings.syncOff") : t("settings.syncMinutes", [m]),
  })),
);

function toCadence(v: string): SyncCadence {
  const n = Number(v);
  return (SYNC_CADENCE_OPTIONS as readonly number[]).includes(n) ? (n as SyncCadence) : 0;
}

const activeValue = computed({
  get: () => String(syncPrefs.activeMinutes),
  set: (v: string) => setActiveCadence(toCadence(v)),
});
const inactiveValue = computed({
  get: () => String(syncPrefs.inactiveMinutes),
  set: (v: string) => setInactiveCadence(toCadence(v)),
});
</script>

<template>
  <div>
    <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <RefreshCw class="h-3.5 w-3.5" /> {{ t("settings.syncTitle") }}
    </label>
    <p class="mb-3 mt-1 text-xs text-muted-foreground">{{ t("settings.syncHint") }}</p>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-2">
        <label class="block text-xs font-medium text-muted-foreground">
          {{ t("settings.syncActive") }}
        </label>
        <UiSelect
          v-model="activeValue"
          :options="cadenceOptions"
          :aria-label="t('settings.syncActive')"
        />
      </div>
      <div class="space-y-2">
        <label class="block text-xs font-medium text-muted-foreground">
          {{ t("settings.syncInactive") }}
        </label>
        <UiSelect
          v-model="inactiveValue"
          :options="cadenceOptions"
          :aria-label="t('settings.syncInactive')"
        />
      </div>
    </div>
  </div>
</template>
