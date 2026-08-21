<script setup lang="ts">
import { type HTMLAttributes, computed } from "vue";
import { cn } from "@/lib/cn";

const props = withDefaults(
  defineProps<{
    type?: "text" | "password" | "email" | "number" | "search" | "url" | "tel" | "date";
    class?: HTMLAttributes["class"];
    modelValue?: string;
  }>(),
  { type: "text" },
);

const emit = defineEmits<{ "update:modelValue": [string] }>();

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLInputElement).value);
}

const inputClass = computed(() =>
  cn(
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    props.class,
  ),
);
</script>

<template>
  <input :type="type" :value="modelValue" :class="inputClass" :data-slot="'input'" @input="onInput" />
</template>