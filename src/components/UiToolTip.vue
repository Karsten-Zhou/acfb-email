<script setup lang="ts">
// UiToolTip — accessible hover/focus popover (no native `title` attribute).
// The bubble is teleported to <body> and pinned with `position: fixed`, so it
// can never be clipped by an overflow ancestor (scrollable panes/nav) nor
// painted under a sibling column. On open it auto-picks the side with enough
// viewport room (flipping from the requested side) and clamps to the window.
import { ref, nextTick, onMounted, onUnmounted } from "vue";
import { cn } from "../lib/cn";

type Side = "top" | "right" | "bottom" | "left";

const props = withDefaults(
  defineProps<{
    label: string;
    side?: Side | "auto";
    class?: string;
  }>(),
  { side: "auto", class: undefined },
);

const open = ref(false);
const pos = ref<{ x: number; y: number } | null>(null);
const wrapEl = ref<HTMLElement | null>(null);
const bubbleEl = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

const GAP = 6; // px between trigger and bubble
const MARGIN = 8; // min distance from viewport edges

const ALL_SIDES: Side[] = ["top", "right", "bottom", "left"];
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function show() {
  if (timer) clearTimeout(timer);
  if (leaveTimer) clearTimeout(leaveTimer);
  timer = setTimeout(async () => {
    open.value = true;
    await nextTick();
    place();
  }, 160);
}
function hide() {
  if (timer) clearTimeout(timer);
  leaveTimer = setTimeout(() => {
    open.value = false;
    pos.value = null;
  }, 60);
}

/** Close instantly (scroll/resize/unmount) without the leave delay. */
function closeNow() {
  if (timer) clearTimeout(timer);
  if (leaveTimer) clearTimeout(leaveTimer);
  open.value = false;
  pos.value = null;
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") closeNow();
}

/** Measure the trigger and pin the bubble fully inside the viewport. */
function place() {
  const trigger = wrapEl.value;
  const bubble = bubbleEl.value;
  if (!trigger || !bubble) return;
  const r = trigger.getBoundingClientRect();
  const bw = bubble.offsetWidth;
  const bh = bubble.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Available space outside each edge of the trigger.
  const space: Record<Side, number> = {
    top: Math.max(0, r.top - GAP),
    bottom: Math.max(0, vh - r.bottom - GAP),
    left: Math.max(0, r.left - GAP),
    right: Math.max(0, vw - r.right - GAP),
  };

  const requested = props.side === "auto" ? null : (props.side as Side);
  const priority: Side[] = requested
    ? [
        requested,
        OPPOSITE[requested],
        ...ALL_SIDES.filter((s) => s !== requested && s !== OPPOSITE[requested]),
      ]
    : [...ALL_SIDES].sort((a, b) => space[b] - space[a]);

  const offset = (side: Side): { x: number; y: number } => {
    switch (side) {
      case "top":
        return { x: r.left + r.width / 2 - bw / 2, y: r.top - bh - GAP };
      case "bottom":
        return { x: r.left + r.width / 2 - bw / 2, y: r.bottom + GAP };
      case "left":
        return { x: r.left - bw - GAP, y: r.top + r.height / 2 - bh / 2 };
      case "right":
        return { x: r.right + GAP, y: r.top + r.height / 2 - bh / 2 };
    }
  };

  let best: { x: number; y: number } | null = null;
  for (const side of priority) {
    const need = side === "top" || side === "bottom" ? bh : bw;
    if (space[side] < need) continue;
    const o = offset(side);
    if (o.x >= MARGIN && o.x + bw <= vw - MARGIN && o.y >= MARGIN && o.y + bh <= vh - MARGIN) {
      best = o;
      break;
    }
  }
  if (!best) {
    // Nothing fits completely — use the best side and clamp inside the window.
    const o = offset(priority[0]);
    best = {
      x: Math.min(Math.max(o.x, MARGIN), Math.max(MARGIN, vw - bw - MARGIN)),
      y: Math.min(Math.max(o.y, MARGIN), Math.max(MARGIN, vh - bh - MARGIN)),
    };
  }
  pos.value = best;
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  // Repositioning on scroll is more work than it's worth; just dismiss.
  window.addEventListener("scroll", closeNow, { capture: true, passive: true });
  window.addEventListener("resize", closeNow);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", closeNow, { capture: true });
  window.removeEventListener("resize", closeNow);
  if (timer) clearTimeout(timer);
  if (leaveTimer) clearTimeout(leaveTimer);
});
</script>

<template>
  <span
    ref="wrapEl"
    class="relative inline-flex"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot />
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-100"
        leave-active-class="transition-opacity duration-75"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <span
          v-if="open"
          ref="bubbleEl"
          role="tooltip"
          :class="
            cn(
              'pointer-events-none fixed z-100 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm',
              props.class,
            )
          "
          :style="pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : undefined"
        >
          {{ label }}
        </span>
      </Transition>
    </Teleport>
  </span>
</template>
