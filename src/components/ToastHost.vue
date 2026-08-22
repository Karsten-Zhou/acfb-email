<script setup lang="ts">
// ToastHost — fixed-bottom toast stack (pattern from the RSS reader).
import { toastState, dismissToast } from "../stores/toast";
import { CheckCircle2, CircleAlert, X } from "lucide-vue-next";

function kindIcon(kind: "success" | "error"): typeof CheckCircle2 {
  return kind === "error" ? CircleAlert : CheckCircle2;
}
</script>

<template>
  <div
    aria-live="polite"
    aria-atomic="false"
    class="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(100vw-2rem,24rem)] flex-col gap-2"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-for="item in toastState.items"
        :key="item.id"
        role="status"
        class="pointer-events-auto flex items-start gap-2.5 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      >
        <component
          :is="kindIcon(item.kind)"
          class="mt-0.5 h-4 w-4 shrink-0"
          :class="item.kind === 'error' ? 'text-destructive' : 'text-emerald-500'"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium leading-tight">{{ item.message }}</p>
          <p v-if="item.description" class="mt-0.5 text-xs text-muted-foreground">
            {{ item.description }}
          </p>
        </div>
        <button
          type="button"
          class="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Dismiss"
          @click="dismissToast(item.id)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>