<script setup lang="ts">
// UiDialog — accessible modal dialog (teleported to body with a backdrop).
// Used for confirm dialogs instead of inline page-flow blocks.
// Emits `close` when the backdrop, Escape, or the (optional) close button is used.
import { onUnmounted, watch } from "vue";

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

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      // Trap focus in the dialog.
      window.addEventListener("keydown", onKey);
    } else {
      window.removeEventListener("keydown", onKey);
    }
  },
  { immediate: true },
);

onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-100"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="close" />
        <!-- Panel -->
        <div
          class="relative w-full rounded-lg border border-border bg-card p-5 shadow-2xl"
          :class="maxWidthClass"
        >
          <div v-if="title || !hideClose" class="mb-3 flex items-center justify-between gap-3">
            <h3 class="text-sm font-semibold">{{ title }}</h3>
            <button
              v-if="!hideClose"
              class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="Close"
              @click="close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <slot />
          <div v-if="$slots.footer" class="mt-4 flex justify-end gap-2">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
