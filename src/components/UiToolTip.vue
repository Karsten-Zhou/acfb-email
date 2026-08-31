<script setup lang="ts">
// UiToolTip — accessible hover/focus tooltip built on reka-ui's Tooltip.
// reka owns positioning (floating-ui side/align/collision handling), the open
// delay, Esc/scroll/resize handling, and ARIA wiring. TooltipPortal keeps the
// bubble teleported to <body> so it can never be clipped by an overflow ancestor.
//
// Touch devices have no hover, and reka's trigger doesn't long-press open in the
// version we pin, so on touch we follow the Android pattern: touch-and-hold the
// trigger to reveal the tooltip (VueUse's onLongPress drives reka's controlled
// `open`). It stays up while you keep holding, lingers briefly after you lift,
// and a short tap on the trigger (or a tap elsewhere) dismisses it. The trigger
// element is captured via a ref on TooltipTrigger (reka's as-child Slot forwards
// the child element), so positioning keeps anchoring to the button itself.
// disable-closing-trigger stops reka from closing on the click that fires when
// you release a long press; ignore-non-keyboard-focus stops a plain tap from
// opening via focus.
import { computed, ref } from "vue";
import { onLongPress, useEventListener, useTimeoutFn } from "@vueuse/core";
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "reka-ui";
import { cn } from "../lib/cn";

/** Resolve a reka as-child component ref to its underlying DOM element. */
function toElement(el: unknown): HTMLElement | null {
  const node = (el as { $el?: HTMLElement } | null)?.$el ?? (el as HTMLElement | null);
  return node instanceof HTMLElement ? node : null;
}

const props = withDefaults(
  defineProps<{
    label: string;
    side?: Side | "auto";
    class?: string;
  }>(),
  { side: "auto", class: undefined },
);

type Side = "top" | "right" | "bottom" | "left";

// reka's default side is "top"; "auto" leaves it unset so reka flips to the
// side with room (avoidCollisions is on by default).
const side = computed<Side | undefined>(() => (props.side === "auto" ? undefined : props.side));

// ---- touch (long-press) support ----
// Touch devices have no hover, so we follow the Android pattern: touch-and-hold
// the trigger to reveal the tooltip. VueUse's onLongPress provides the press
// detection (Android's 500 ms delay and 10 px distance-threshold defaults) and
// its onMouseUp tells us whether the gesture was a long press so we can linger
// after lifting or dismiss on a short tap. reka's disable-closing-trigger stops
// it from closing on the click that fires when you release a long press;
// ignore-non-keyboard-focus stops a plain tap from opening via focus.
const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const LINGER_MS = 1200; // how long the tooltip stays after the finger lifts

// Linger briefly after a long-press release, then hide.
const { start: startLinger, stop: stopLinger } = useTimeoutFn(
  () => (open.value = false),
  LINGER_MS,
);

onLongPress(triggerEl, () => (open.value = true), {
  delay: 500,
  distanceThreshold: 10,
  onMouseUp: (_duration, _distance, isLongPress) => {
    if (isLongPress) startLinger();
    else if (open.value) open.value = false; // short tap on the trigger dismisses
  },
});

// A tap anywhere outside the trigger dismisses an open tooltip (Android pattern).
useEventListener("pointerdown", (e: PointerEvent) => {
  if (!open.value) return;
  const target = e.target as Node;
  if (triggerEl.value?.contains(target)) return;
  stopLinger();
  open.value = false;
});

/** Capture the trigger's DOM element (reka forwards its child element). */
function setTriggerRef(el: unknown) {
  triggerEl.value = toElement(el);
}
</script>

<template>
  <TooltipProvider>
    <TooltipRoot
      v-model:open="open"
      :delay-duration="160"
      disable-closing-trigger
      ignore-non-keyboard-focus
    >
      <TooltipTrigger :ref="setTriggerRef" as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :side-offset="6"
          :class="
            cn(
              'z-100 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm',
              props.class,
            )
          "
        >
          {{ label }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
