<script setup lang="ts">
// UiSelect — dropdown for choosing one of a small set of options, built on
// reka-ui's Select. reka owns positioning (popper), keyboard navigation,
// ARIA, and typeahead; SelectPortal teleports the menu to <body> so it can
// never be clipped by an overflow ancestor.
import { computed } from "vue";
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport,
} from "reka-ui";
import { ChevronDown, Check } from "lucide-vue-next";

interface Option {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: Option[];
    /** Short label rendered before the selected value (e.g. "From:"). */
    prefix?: string;
    ariaLabel?: string;
  }>(),
  { prefix: undefined, ariaLabel: undefined },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const selected = computed(() => props.options.find((o) => o.value === props.modelValue));

function onValueChange(value: unknown) {
  emit("update:modelValue", typeof value === "string" ? value : String(value ?? ""));
}
</script>

<template>
  <SelectRoot :model-value="modelValue" @update:model-value="onValueChange">
    <SelectTrigger
      class="inline-flex h-8 min-w-0 max-w-40 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring sm:max-w-65"
      :aria-label="ariaLabel"
    >
      <span v-if="prefix" class="shrink-0 text-muted-foreground">{{ prefix }}</span>
      <span class="min-w-0 truncate">{{ selected?.label ?? "" }}</span>
      <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        class="z-100 min-w-[200px] w-[var(--reka-select-trigger-width)] max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
      >
        <SelectViewport>
          <SelectItem
            v-for="o in options"
            :key="o.value"
            :value="o.value"
            class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <span class="min-w-0 flex-1 truncate">{{ o.label }}</span>
            <SelectItemIndicator>
              <Check class="h-4 w-4 shrink-0" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
