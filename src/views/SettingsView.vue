<script setup lang="ts">
// Settings view — composition root: header (back/sign-out) + section
// components. Each section lives in its own component under parts/:
//   AccountSettings (OAuth + IMAP form + account list),
//   PreferencesPanel (language/theme),
//   AboutPanel.
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { logout } from "../stores/auth";
import { loadAccounts } from "../stores/accounts";
import { api, type HealthPayload } from "../lib/api";
import { t } from "../lib/i18n";
import UiButton from "../components/UiButton.vue";
import UiToolTip from "../components/UiToolTip.vue";
import AccountSettings from "./parts/AccountSettings.vue";
import PreferencesPanel from "./parts/PreferencesPanel.vue";
import AboutPanel from "./parts/AboutPanel.vue";
import { ChevronLeft } from "lucide-vue-next";

const router = useRouter();

const notice = ref<string | null>(null);
const meta = ref<HealthPayload | null>(null);

onMounted(async () => {
  await Promise.all([
    loadAccounts(),
    api
      .health()
      .then((h) => (meta.value = h))
      .catch(() => null),
  ]);
  const connected = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("connected");
  if (connected === "google" || connected === "microsoft") {
    notice.value = connected === "google" ? t("connectGmail") + " ✓" : t("connectOutlook") + " ✓";
  }
});

async function doLogout() {
  await logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <header class="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
      <UiToolTip :label="t('settings')">
        <UiButton
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          @click="router.push({ name: 'mailbox' })"
        >
          <ChevronLeft class="h-4 w-4" />
        </UiButton>
      </UiToolTip>
      <h1 class="text-sm font-semibold">{{ t("settings") }}</h1>
      <div class="flex-1" />
      <UiToolTip :label="t('signOut')">
        <UiButton variant="ghost-destructive" size="sm" @click="doLogout">{{
          t("signOut")
        }}</UiButton>
      </UiToolTip>
    </header>

    <main class="flex-1 overflow-y-auto p-4 md:p-6">
      <section class="mx-auto max-w-2xl space-y-6">
        <AccountSettings :meta="meta" :notice="notice" @dismiss-notice="notice = null" />
        <PreferencesPanel />
        <AboutPanel />
      </section>
    </main>
  </div>
</template>
