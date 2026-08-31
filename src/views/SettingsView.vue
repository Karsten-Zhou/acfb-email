<script setup lang="ts">
// Settings view — composition root: header (back/sign-out) + section
// components. Each section lives in its own component under parts/:
//   AccountSettings (OAuth + IMAP form + account list),
//   PreferencesPanel (language/theme),
//   AboutPanel.
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type HealthPayload } from "../lib/api";
import { t } from "../lib/i18n";
import UiButton from "../components/UiButton.vue";
import UiToolTip from "../components/UiToolTip.vue";
import AccountSettings from "./parts/AccountSettings.vue";
import PreferencesPanel from "./parts/PreferencesPanel.vue";
import PrivacyPanel from "./parts/PrivacyPanel.vue";
import AboutPanel from "./parts/AboutPanel.vue";
import { ChevronLeft } from "@lucide/vue";

const router = useRouter();

const meta = ref<HealthPayload | null>(null);

onMounted(async () => {
  // Accounts + live sync-state are loaded by AccountSettings (TanStack Query).
  api
    .health()
    .then((h) => (meta.value = h))
    .catch(() => null);
});
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <header class="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
      <UiToolTip :label="t('common.settings')">
        <UiButton
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          @click="router.push({ name: 'mailbox' })"
        >
          <ChevronLeft class="h-4 w-4" />
        </UiButton>
      </UiToolTip>
      <h1 class="text-sm font-semibold">{{ t("common.settings") }}</h1>
      <div class="flex-1" />
    </header>

    <main class="flex-1 overflow-y-auto p-4 md:p-6">
      <section class="mx-auto max-w-2xl space-y-6">
        <AccountSettings :meta="meta" />
        <PreferencesPanel />
        <PrivacyPanel />
        <AboutPanel />
      </section>
    </main>
  </div>
</template>
