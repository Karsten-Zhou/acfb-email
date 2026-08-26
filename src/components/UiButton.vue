<script setup lang="ts">
// UiButton — flat button component built on reka-ui's Primitive, so it can
// render as any element/component (`as`) or merge onto a child (`asChild`).
import { computed, type HTMLAttributes } from "vue";
import { Primitive, type PrimitiveProps } from "reka-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        // Ghost button that stays destructive on hover (used for sign-out,
        // delete-account etc. — the base `text-destructive` would otherwise be
        // overridden by ghost's hover:text-accent-foreground).
        "ghost-destructive": "text-destructive hover:bg-destructive hover:text-white",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariants["variant"];
    size?: ButtonVariants["size"];
    type?: "button" | "submit" | "reset";
    as?: PrimitiveProps["as"];
    asChild?: PrimitiveProps["asChild"];
    class?: HTMLAttributes["class"];
  }>(),
  {
    variant: "default",
    size: "default",
    type: "button",
    as: "button",
    asChild: false,
    class: undefined,
  },
);

const computedClass = computed(() =>
  cn(buttonVariants({ variant: props.variant, size: props.size }), props.class),
);
</script>

<template>
  <Primitive :as="as" :as-child="asChild" :type="type" :class="computedClass" :data-slot="'button'">
    <slot />
  </Primitive>
</template>
