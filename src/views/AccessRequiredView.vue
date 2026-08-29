<script setup lang="ts">
import { t } from "../lib/i18n";
</script>

<template>
  <div class="flex min-h-full items-center justify-center bg-background p-6">
    <div class="card-surface w-full max-w-md p-8 text-center">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t("app.accessRequiredTitle") }}</h1>
      <p class="mt-2 text-sm text-muted-foreground">{{ t("app.accessRequiredBody") }}</p>
    </div>
  </div>
</template>
