<script setup lang="ts">
// AboutPanel — version, build time, and source link.
import { t, formatDateTime } from "../../lib/i18n";
import { Info, ExternalLink } from "@lucide/vue";

const appVersion = __APP_VERSION__;
const appBuildTime = __APP_BUILD_TIME__;
const APP_REPO_URL = "https://github.com/XiaoSong-CPE/a-cloudflare-based-email-client";
</script>

<template>
  <div class="card-surface p-4">
    <h2 class="mb-3 flex items-center gap-1.5 text-sm font-semibold">
      <Info class="h-4 w-4" /> {{ t("common.about") }}
    </h2>
    <dl class="space-y-1.5 text-sm">
      <div class="flex justify-between">
        <dt class="text-muted-foreground">{{ t("common.version") }}</dt>
        <dd class="font-medium">{{ appVersion }}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-muted-foreground">{{ t("common.buildTime") }}</dt>
        <dd class="font-medium">{{ formatDateTime(appBuildTime) }}</dd>
      </div>
    </dl>
    <a
      :href="APP_REPO_URL"
      target="_blank"
      rel="noopener noreferrer"
      class="mt-3 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
    >
      <ExternalLink class="h-4 w-4" /> {{ t("common.viewSource") }}
    </a>
  </div>
</template>
