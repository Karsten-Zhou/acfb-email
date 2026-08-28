<script setup lang="ts">
import ToastHost from "./components/ToastHost.vue";
import AccessRequiredView from "./views/AccessRequiredView.vue";
import { accessState } from "./lib/api";
</script>

<template>
  <AccessRequiredView v-if="accessState.missing" />
  <RouterView v-else />
  <ToastHost />
</template>
