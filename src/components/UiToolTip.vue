<script setup lang="ts">
// UiToolTip — accessible hover/focus tooltip built on reka-ui's Tooltip.
// reka owns positioning (floating-ui side/align/collision handling), the open
// delay, Esc/scroll/resize handling, and ARIA wiring. TooltipPortal keeps the
// bubble teleported to <body> so it can never be clipped by an overflow ancestor.
import { computed } from "vue";
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "reka-ui";
import { cn } from "../lib/cn";

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
</script>

<template>
  <TooltipProvider>
    <TooltipRoot :delay-duration="160">
      <TooltipTrigger as-child>
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
