<script setup lang="ts">
import ToastHost from "./components/ToastHost.vue";
import AccessRequiredView from "./views/AccessRequiredView.vue";
import { accessState } from "./lib/api";
import { initSyncPrefs } from "./lib/syncPrefs";
import { useAutoSync } from "./composables/useAutoSync";

initSyncPrefs();
// Browser auto-checks while the app is open (refresh-on-settle lives in the
// /states poll, see stores/accounts.ts).
useAutoSync();
</script>

<template>
  <AccessRequiredView v-if="accessState.missing" />
  <RouterView v-else />
  <ToastHost />
</template>
