<script setup lang="ts">
// PrivacyPanel — remote-image loading controls. A three-way choice (always /
// never / whitelist) with a short, non-technical explanation of the risk, and
// an editable trusted-sender list shown in whitelist mode.
import { computed, ref } from "vue";
import { t } from "../../lib/i18n";
import {
  remoteImagesState,
  setRemoteImageSetting,
  setRemoteImageAllowlist,
  type RemoteImageSetting,
} from "../../lib/remoteImages";
import UiSelect from "../../components/UiSelect.vue";
import UiInput from "../../components/UiInput.vue";
import UiButton from "../../components/UiButton.vue";
import { ImageOff, Plus, X, ShieldCheck } from "@lucide/vue";

const setting = computed({
  get: () => remoteImagesState.setting,
  set: (v: RemoteImageSetting) => setRemoteImageSetting(v),
});

const modeOptions = [
  { value: "block", label: t("privacy.remoteImagesBlock") },
  { value: "allow", label: t("privacy.remoteImagesAllow") },
  { value: "whitelist", label: t("privacy.remoteImagesWhitelist") },
];

const newEntry = ref("");
const addError = ref<string | null>(null);

/** Simple email check: one "@", non-empty local part, domain with a dot. */
function looksLikeEmail(s: string): boolean {
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return false;
  return s.slice(at + 1).includes(".");
}
/** Simple domain check: no "@", contains a dot. */
function looksLikeDomain(s: string): boolean {
  return !s.includes("@") && s.includes(".");
}

function addAllowlistEntry() {
  const raw = newEntry.value.trim();
  if (!raw) return;
  const lower = raw.toLowerCase();
  // Accept an email address or a bare domain; anything else is rejected.
  if (!looksLikeEmail(lower) && !looksLikeDomain(lower)) {
    addError.value = t("privacy.allowlistInvalid");
    return;
  }
  addError.value = null;
  if (!remoteImagesState.allowlist.some((e) => e.toLowerCase() === lower)) {
    setRemoteImageAllowlist([...remoteImagesState.allowlist, lower]);
  }
  newEntry.value = "";
}

function removeAllowlistEntry(entry: string) {
  setRemoteImageAllowlist(remoteImagesState.allowlist.filter((e) => e !== entry));
}
</script>

<template>
  <div class="card-surface p-4">
    <h2 class="mb-3 flex items-center gap-1.5 text-sm font-semibold">
      <ShieldCheck class="h-4 w-4 text-muted-foreground" /> {{ t("privacy.title") }}
    </h2>

    <div class="space-y-4">
      <div class="space-y-1.5">
        <label class="block text-xs font-medium text-muted-foreground">
          {{ t("privacy.remoteImages") }}
        </label>
        <UiSelect
          v-model="setting"
          :options="modeOptions"
          :aria-label="t('privacy.remoteImages')"
        />
        <p class="text-xs text-muted-foreground">{{ t("privacy.remoteImagesHint") }}</p>
      </div>

      <div v-if="setting === 'whitelist'" class="space-y-2">
        <label class="block text-xs font-medium text-muted-foreground">
          {{ t("privacy.allowlistLabel") }}
        </label>
        <ul v-if="remoteImagesState.allowlist.length" class="space-y-1.5">
          <li
            v-for="entry in remoteImagesState.allowlist"
            :key="entry"
            class="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-sm"
          >
            <span class="min-w-0 truncate">{{ entry }}</span>
            <button
              class="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
              :aria-label="t('privacy.allowlistRemove')"
              @click="removeAllowlistEntry(entry)"
            >
              <X class="h-4 w-4" />
            </button>
          </li>
        </ul>
        <p v-else class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageOff class="h-3.5 w-3.5" /> {{ t("privacy.allowlistEmpty") }}
        </p>
        <div class="flex gap-2">
          <UiInput
            v-model="newEntry"
            :placeholder="t('privacy.allowlistPlaceholder')"
            class="flex-1"
            @keydown.enter.prevent="addAllowlistEntry"
          />
          <UiButton variant="secondary" size="sm" @click="addAllowlistEntry">
            <Plus class="h-4 w-4" /> {{ t("privacy.allowlistAdd") }}
          </UiButton>
        </div>
        <p v-if="addError" class="text-xs text-destructive">{{ addError }}</p>
        <p class="text-xs text-muted-foreground">{{ t("privacy.allowlistHint") }}</p>
      </div>
    </div>
  </div>
</template>
