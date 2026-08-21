<script setup lang="ts">
// AppTooltip — lightweight hover/focus popover (no native `title` attribute).
// Uses only CSS + role=tooltip semantics.
import { ref, computed, onMounted, onUnmounted } from "vue";
import { cn } from "@/lib/cn";

const props = withDefaults(
  defineProps<{
    label: string;
    side?: "top" | "right" | "bottom" | "left";
    class?: string;
  }>(),
  { side: "top" },
);

const open = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

function show() {
  if (timer) clearTimeout(timer);
  if (leaveTimer) clearTimeout(leaveTimer);
  timer = setTimeout(() => (open.value = true), 160);
}
function hide() {
  if (timer) clearTimeout(timer);
  leaveTimer = setTimeout(() => (open.value = false), 60);
}

const posClass = computed(() => {
  switch (props.side) {
    case "right":
      return "left-full top-1/2 ml-1.5 -translate-y-1/2";
    case "bottom":
      return "top-full left-1/2 mt-1.5 -translate-x-1/2";
    case "left":
      return "right-full top-1/2 mr-1.5 -translate-y-1/2";
    default:
      return "bottom-full left-1/2 mb-1.5 -translate-x-1/2";
  }
});

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  if (timer) clearTimeout(timer);
  if (leaveTimer) clearTimeout(leaveTimer);
});
</script>

<template>
  <span class="relative inline-flex" @mouseenter="show" @mouseleave="hide" @focusin="show" @focusout="hide">
    <slot />
    <Transition
      enter-active-class="transition-opacity duration-100"
      leave-active-class="transition-opacity duration-75"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <span
        v-if="open"
        role="tooltip"
        :class="cn(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm',
          posClass,
          props.class,
        )"
      >
        {{ label }}
      </span>
    </Transition>
  </span>
</template>