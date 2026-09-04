<script setup lang="ts">
// Access security status and, when enabled, the identity Cloudflare Access
// asserted for this request.
import { onMounted, ref } from "vue";
import { api, type AccessInfoPayload } from "../../lib/api";
import { t, formatDateTime } from "../../lib/i18n";
import { ShieldCheck, ShieldAlert } from "@lucide/vue";

const info = ref<AccessInfoPayload | null>(null);

onMounted(async () => {
  api
    .accessInfo()
    .then((i) => (info.value = i))
    .catch(() => (info.value = null));
});

const session = () => info.value?.session;
const expiresLabel = () => {
  const exp = session()?.exp;
  return exp ? formatDateTime(exp * 1000) : "";
};
</script>

<template>
  <div class="card-surface p-4">
    <h2 class="mb-3 flex items-center gap-1.5 text-sm font-semibold">
      <ShieldCheck v-if="info?.enabled" class="h-4 w-4 text-muted-foreground" />
      <ShieldAlert v-else class="h-4 w-4 text-muted-foreground" />
      {{ t("access.title") }}
    </h2>

    <div v-if="!info" class="text-sm text-muted-foreground">{{ t("common.loading") }}</div>

    <template v-else>
      <div class="mb-3 flex items-center gap-2">
        <span
          v-if="info.enabled"
          class="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
        >
          {{ t("access.badgeEnabled") }}
        </span>
        <span
          v-else
          class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {{ t("access.badgeBasic") }}
        </span>
        <p v-if="!info.enabled" class="text-xs text-muted-foreground">
          {{ t("access.hintBasic") }}
        </p>
      </div>

      <template v-if="info.enabled">
        <p class="mb-3 text-xs text-muted-foreground">{{ t("access.hintEnabled") }}</p>
        <dl class="space-y-1.5 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted-foreground">{{ t("access.aud") }}</dt>
            <dd class="max-w-[55%] truncate font-mono text-xs" :title="info.aud ?? undefined">
              {{ info.aud }}
            </dd>
          </div>
        </dl>

        <h3 class="mb-1 mt-4 text-xs font-semibold uppercase text-muted-foreground">
          {{ t("access.sessionTitle") }}
        </h3>
        <dl v-if="session()" class="space-y-1.5 text-sm">
          <div v-if="session()?.email" class="flex justify-between">
            <dt class="text-muted-foreground">{{ t("access.email") }}</dt>
            <dd class="font-medium">{{ session()?.email }}</dd>
          </div>
          <div v-if="session()?.groups?.length" class="flex justify-between gap-4">
            <dt class="shrink-0 text-muted-foreground">{{ t("access.groups") }}</dt>
            <dd class="min-w-0 text-right font-medium">
              {{ (session()?.groups ?? []).join(", ") }}
            </dd>
          </div>
          <div v-if="session()?.geo" class="flex justify-between">
            <dt class="text-muted-foreground">{{ t("access.country") }}</dt>
            <dd class="font-medium">{{ session()?.geo }}</dd>
          </div>
          <div v-if="session()?.ip" class="flex justify-between">
            <dt class="text-muted-foreground">{{ t("access.ip") }}</dt>
            <dd class="font-medium">{{ session()?.ip }}</dd>
          </div>
          <div v-if="expiresLabel()" class="flex justify-between">
            <dt class="text-muted-foreground">{{ t("access.expires") }}</dt>
            <dd class="font-medium">{{ expiresLabel() }}</dd>
          </div>
        </dl>
        <p v-else class="text-xs text-muted-foreground">{{ t("access.sessionNone") }}</p>
      </template>
    </template>
  </div>
</template>
