<script setup lang="ts">
// App root: keeps the account-state poller alive for the whole session so the
// sidebar/settings reflect background sync status (running -> healthy etc.)
// without manual refreshes. It only runs while logged in (it 401s otherwise
// and the poll loop is cheap + self-healing).
import { onMounted, onUnmounted } from "vue";
import {
  startAccountStatePolling,
  stopAccountStatePolling,
} from "./stores/accounts";
import ToastHost from "./components/ToastHost.vue";

onMounted(startAccountStatePolling);
onUnmounted(stopAccountStatePolling);
</script>

<template>
  <RouterView />
  <ToastHost />
</template>
