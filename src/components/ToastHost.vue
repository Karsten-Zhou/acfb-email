<script setup lang="ts">
// ToastHost — fixed-bottom toast stack built on reka-ui's Toast.
import { toastState, dismissToast, type ToastItem } from "../stores/toast";
import {
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from "reka-ui";
import { CheckCircle2, CircleAlert, X } from "lucide-vue-next";

const AUTO_DISMISS_MS = 5000;
/** Keep the item mounted long enough for reka's exit transition to play. */
const EXIT_MS = 300;

function kindIcon(kind: "success" | "error"): typeof CheckCircle2 {
  return kind === "error" ? CircleAlert : CheckCircle2;
}

function onOpenChange(item: ToastItem, open: boolean) {
  if (!open) {
    item.open = false; // let reka animate the exit...
    setTimeout(() => dismissToast(item.id), EXIT_MS); // ...then drop it from the list.
  }
}
</script>

<template>
  <ToastProvider swipe-direction="right">
    <ToastViewport
      class="pointer-events-none fixed right-4 bottom-4 z-100 flex w-[min(100vw-2rem,24rem)] flex-col gap-2 outline-none"
    />
    <ToastRoot
      v-for="item in toastState.items"
      :key="item.id"
      :open="item.open"
      :duration="AUTO_DISMISS_MS"
      class="pointer-events-auto flex items-start gap-2.5 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg transition-[translate,opacity] duration-200 ease-out data-[state=open]:translate-y-0 data-[state=open]:opacity-100 data-[state=closed]:translate-y-2 data-[state=closed]:opacity-0"
      @update:open="(open) => onOpenChange(item, open)"
    >
      <component
        :is="kindIcon(item.kind)"
        class="mt-0.5 h-4 w-4 shrink-0"
        :class="item.kind === 'error' ? 'text-destructive' : 'text-emerald-500'"
      />
      <div class="min-w-0 flex-1">
        <ToastTitle class="text-sm font-medium leading-tight">{{ item.message }}</ToastTitle>
        <ToastDescription v-if="item.description" class="mt-0.5 text-xs text-muted-foreground">
          {{ item.description }}
        </ToastDescription>
      </div>
      <ToastClose
        class="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Dismiss"
      >
        <X class="h-3.5 w-3.5" />
      </ToastClose>
    </ToastRoot>
  </ToastProvider>
</template>
