<script setup lang="ts">
// UiSelect — a light dropdown for choosing one of a small set of options.
// Unlike a native <select>, the trigger truncates long labels with an
// ellipsis and the menu is teleported to <body> (fixed positioned) so it can
// never be clipped by an overflow ancestor.
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
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

const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const pos = ref<{ left: number; top: number; width: number } | null>(null);

const selected = computed(() => props.options.find((o) => o.value === props.modelValue));

async function toggle() {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  await nextTick();
  place();
}

function close() {
  open.value = false;
  pos.value = null;
}

function choose(value: string) {
  emit("update:modelValue", value);
  close();
}

/** Pin the menu below (or above, if there's no room) the trigger. */
function place() {
  const trigger = triggerEl.value;
  const menu = menuEl.value;
  if (!trigger || !menu) return;
  const r = trigger.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const dropUp = window.innerHeight - r.bottom < mh && r.top > mh;
  const top = dropUp ? r.top - mh - 4 : r.bottom + 4;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
  pos.value = { left, top, width: Math.max(r.width, 200) };
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return;
  const target = e.target as Node;
  if (triggerEl.value?.contains(target) || menuEl.value?.contains(target)) return;
  close();
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  window.addEventListener("scroll", close, { capture: true, passive: true });
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onDocClick);
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", close);
  window.removeEventListener("scroll", close, { capture: true });
});
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="inline-flex h-8 min-w-0 max-w-[160px] items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[260px]"
    :aria-label="ariaLabel"
    aria-haspopup="true"
    :aria-expanded="open"
    @click="toggle"
  >
    <span v-if="prefix" class="shrink-0 text-muted-foreground">{{ prefix }}</span>
    <span class="min-w-0 truncate">{{ selected?.label ?? "" }}</span>
    <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
  </button>

  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-75"
      leave-active-class="transition-opacity duration-75"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <ul
        v-if="open"
        ref="menuEl"
        class="fixed z-[100] max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        :style="
          pos ? { left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width}px` } : undefined
        "
      >
        <li v-for="o in options" :key="o.value">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            @click="choose(o.value)"
          >
            <span class="min-w-0 flex-1 truncate">{{ o.label }}</span>
            <Check v-if="o.value === modelValue" class="h-4 w-4 shrink-0" />
          </button>
        </li>
      </ul>
    </Transition>
  </Teleport>
</template>
