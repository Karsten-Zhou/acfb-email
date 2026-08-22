<script setup lang="ts">
import { Github } from "lucide-vue-next";
import { t } from "../lib/i18n";
</script>

<template>
  <div class="flex min-h-full items-center justify-center bg-background p-6">
    <div class="w-full max-w-md">
      <div class="card-surface p-8">
        <div class="flex flex-col items-center text-center">
          <div
            class="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
          >
            <svg viewBox="0 0 32 32" class="h-7 w-7">
              <path d="M8 12l8 6 8-6v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V12z" fill="currentColor" />
            </svg>
          </div>
          <h1 class="text-2xl font-semibold tracking-tight">{{ t("appName") }}</h1>
          <p class="mt-2 text-sm text-muted-foreground">{{ t("loginTitle") }}</p>
        </div>

        <div class="mt-8">
          <a
            href="/api/auth/login"
            class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Github class="h-4 w-4" />
            {{ t("loginCta") }}
          </a>
        </div>

        <p class="mt-6 text-center text-xs text-muted-foreground">{{ t("loginAllowlist") }}</p>
      </div>
    </div>
  </div>
</template>
