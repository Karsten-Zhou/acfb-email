<script setup lang="ts">
// UiDialog — accessible modal dialog (teleported to body with a backdrop),
// built on reka-ui's Dialog.
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { X } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    /** Prevent closing (while an async action is running). */
    busy?: boolean;
    /** Hide the top-right X close button. */
    hideClose?: boolean;
    maxWidthClass?: string;
  }>(),
  { maxWidthClass: "max-w-sm", title: undefined, busy: false, hideClose: false },
);

const emit = defineEmits<{ close: [] }>();

function close() {
  if (!props.busy) emit("close");
}

/** reka emits `update:open=false` for Esc/backdrop/close intents. */
function onOpenChange(open: boolean) {
  if (!open) close();
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/50" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-2xl"
        :class="maxWidthClass"
      >
        <DialogDescription class="sr-only">{{ title }}</DialogDescription>
        <div v-if="title || !hideClose" class="mb-3 flex items-center justify-between gap-3">
          <DialogTitle class="text-sm font-semibold">{{ title }}</DialogTitle>
          <button
            v-if="!hideClose"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Close"
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <slot />
        <div v-if="$slots.footer" class="mt-4 flex justify-end gap-2">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
