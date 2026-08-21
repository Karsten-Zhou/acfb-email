<script setup lang="ts">
import { Github } from "lucide-vue-next";
</script>

<template>
  <div class="min-h-full flex items-center justify-center p-6">
    <div class="w-full max-w-md">
      <div class="rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="flex flex-col items-center text-center">
          <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-white">
            <svg viewBox="0 0 32 32" class="h-7 w-7">
              <path d="M8 12l8 6 8-6v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V12z" fill="currentColor"/>
            </svg>
          </div>
          <h1 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Mail</h1>
          <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Your personal email client. Sign in with GitHub to continue.
          </p>
        </div>

        <div class="mt-8">
          <a
            href="/api/auth/login"
            class="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <Github class="h-4 w-4" />
            Continue with GitHub
          </a>
        </div>

        <p class="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          Access is restricted to an explicit allowlist. Your mail data never leaves this application.
        </p>
      </div>
    </div>
  </div>
</template>