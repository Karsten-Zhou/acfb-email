<script setup lang="ts">
// UiSwitch — toggle switch (v-model:modelValue boolean).
import { cn } from "../lib/cn";

const modelValue = defineModel<boolean>({ default: false });
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :class="
      cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        modelValue ? 'bg-primary' : 'bg-input',
        $attrs.class,
      )
    "
    @click="modelValue = !modelValue"
  >
    <span
      :class="
        cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg transition-transform',
          modelValue ? 'translate-x-4' : 'translate-x-0',
        )
      "
    />
  </button>
</template>
