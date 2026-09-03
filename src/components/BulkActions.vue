<script setup lang="ts">
// BulkActions — the mark-read/move/delete bulk operations shown when messages
// are selected. Shared by the desktop list header and mobile top bar, so the
// two surfaces stay in sync. Priority overflow (@fluentui/priority-overflow)
// folds the lowest-priority actions into a "…" menu as width shrinks; delete
// folds first, mark-read stays visible longest. The "…" menu is positioned by
// the generic useOverflowMenu, as in the reader header.
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
  type Component,
} from "vue";
import { createOverflowManager } from "@fluentui/priority-overflow";
import { t } from "../lib/i18n";
import Button from "./UiButton.vue";
import AppTooltip from "./UiToolTip.vue";
import { useOverflowMenu } from "../composables/useOverflowMenu";
import { FolderInput, Trash2, CheckCheck, MoreHorizontal } from "@lucide/vue";

defineProps<{
  selectedCount: number;
}>();

const emit = defineEmits<{
  "mark-read": [];
  move: [];
  delete: [];
}>();

/** Actions reachable from the bulk row (map 1:1 to emits). */
type BulkAction = "mark-read" | "move" | "delete";

/** A bulk action: icon + text label, plus its overflow priority. */
interface ActionDef {
  key: BulkAction;
  icon: Component;
  label: string;
  /** Higher priority = overflows later (stays visible longer). */
  priority: number;
  danger?: boolean;
}

/** Mark-read has the highest priority so it stays visible longest. */
const actions: ActionDef[] = [
  {
    key: "mark-read",
    icon: CheckCheck,
    label: t("message.markRead"),
    priority: 3,
  },
  { key: "move", icon: FolderInput, label: t("message.move"), priority: 2 },
  {
    key: "delete",
    icon: Trash2,
    label: t("common.delete"),
    priority: 1,
    danger: true,
  },
];

// ---- mobile/overflow "…" action menu (generic anchored menu) ----
const {
  open: moreOpen,
  triggerEl: moreBtnEl,
  menuEl: moreMenuEl,
  pos: morePos,
  toggle: toggleMore,
  close: closeMore,
} = useOverflowMenu();

// ---- priority overflow (@fluentui/priority-overflow) ----
const overflowContainerEl = ref<HTMLElement | null>(null);
const actionBtnEls = ref<Partial<Record<BulkAction, HTMLElement | null>>>({});
const itemVisibility = reactive<Record<string, boolean>>(
  Object.fromEntries(actions.map((a) => [a.key, true])),
);
const invisibleIds = ref<string[]>([]);
const overflowVisible = computed(() => invisibleIds.value.length > 0);

let overflowManager: ReturnType<typeof createOverflowManager> | null = null;
let overflowObserving = false;

// Stable ref callbacks per key (re-renders won't null out DOM refs).
const actionRefFns: Record<string, (el: unknown) => void> = {};
function getActionRef(key: BulkAction) {
  if (!actionRefFns[key]) {
    actionRefFns[key] = (el: unknown) => {
      const node = (el as { $el?: HTMLElement } | null)?.$el ?? (el as HTMLElement | null);
      actionBtnEls.value[key] = node;
    };
  }
  return actionRefFns[key];
}

function teardownOverflow() {
  overflowManager?.disconnect();
  overflowManager = null;
  overflowObserving = false;
  for (const a of actions) itemVisibility[a.key] = true;
  invisibleIds.value = [];
  actionBtnEls.value = {};
}

function setupOverflow() {
  nextTick(() => {
    if (!overflowContainerEl.value) return;
    if (!overflowManager) {
      overflowManager = createOverflowManager({
        overflowDirection: "end",
        padding: 8, // gap between buttons
        onUpdateItemVisibility: ({ item, visible }) => {
          // Apply visibility synchronously so measurements and the DOM never race.
          itemVisibility[item.id] = visible;
          if (visible) item.element.removeAttribute("data-overflowing");
          else item.element.setAttribute("data-overflowing", "");
        },
        onUpdateOverflow: ({ invisibleItems }) => {
          invisibleIds.value = invisibleItems.map((i) => i.id);
        },
      });
    }
    for (const a of actions) {
      const el = actionBtnEls.value[a.key];
      if (el) overflowManager.addItem({ element: el, id: a.key, priority: a.priority });
    }
    if (moreBtnEl.value) overflowManager.addOverflowMenu(moreBtnEl.value);
    if (!overflowObserving) {
      overflowManager.observe(overflowContainerEl.value, { forceUpdate: true });
      overflowObserving = true;
    } else {
      overflowManager.forceUpdate();
    }
  });
}

// Mount/unmount as the desktop header and mobile top bar swap. The generic
// useOverflowMenu positions the "…" menu.
onMounted(setupOverflow);
onUnmounted(teardownOverflow);
watch(overflowContainerEl, (el) => (el ? setupOverflow() : teardownOverflow()));

// Reserve the "…" button's width while items overflow (mirrors the official
// register/unregister pattern).
watch(overflowVisible, async (visible) => {
  if (!visible) {
    closeMore();
    overflowManager?.removeOverflowMenu();
    overflowManager?.update();
    return;
  }
  await nextTick();
  if (moreBtnEl.value) overflowManager?.addOverflowMenu(moreBtnEl.value);
  overflowManager?.forceUpdate();
});

/** Actions currently folded into the "…" menu (kept in display order). */
const foldedActions = computed(() => actions.filter((a) => !itemVisibility[a.key]));

/** Run a bulk action. All of them dismiss the menu immediately. */
function runAction(action: BulkAction) {
  closeMore();
  (emit as (e: BulkAction) => void)(action);
}
</script>

<template>
  <template v-if="selectedCount > 0">
    <!-- A row of labelled buttons; lowest-priority ones fold into the "…"
         menu (driven by @fluentui/priority-overflow). -->
    <div
      ref="overflowContainerEl"
      class="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden"
    >
      <template v-for="a in actions" :key="a.key">
        <Button
          :ref="getActionRef(a.key)"
          variant="ghost"
          size="sm"
          class="shrink-0 gap-1.5 px-2.5"
          :class="a.danger ? 'text-destructive' : ''"
          @click="runAction(a.key)"
        >
          <component :is="a.icon" class="h-4 w-4" />
          <span class="whitespace-nowrap">{{ a.label }}</span>
          <span v-if="a.key === 'delete'" class="whitespace-nowrap">({{ selectedCount }})</span>
        </Button>
      </template>
      <div v-if="overflowVisible" ref="moreBtnEl" class="relative shrink-0">
        <AppTooltip :label="t('common.moreActions')">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            aria-haspopup="true"
            :aria-expanded="moreOpen"
            @click="toggleMore"
          >
            <MoreHorizontal class="h-4 w-4" />
          </Button>
        </AppTooltip>
        <Teleport to="body">
          <Transition
            enter-active-class="transition-opacity duration-75"
            leave-active-class="transition-opacity duration-75"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <div
              v-if="moreOpen && foldedActions.length"
              ref="moreMenuEl"
              role="menu"
              class="fixed z-100 w-52 rounded-md border border-border bg-popover p-1 shadow-md"
              :style="morePos ? { left: `${morePos.left}px`, top: `${morePos.top}px` } : undefined"
            >
              <template v-for="a in foldedActions" :key="a.key">
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  :class="a.danger ? 'text-destructive hover:bg-destructive hover:text-white' : ''"
                  @click="runAction(a.key)"
                >
                  <component :is="a.icon" class="h-4 w-4" />
                  {{ a.label }}
                  <span v-if="a.key === 'delete'">({{ selectedCount }})</span>
                </button>
              </template>
            </div>
          </Transition>
        </Teleport>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* @fluentui/priority-overflow contract: overflowed items must be removed from
   layout synchronously (the engine measures widths while it folds). */
[data-overflowing] {
  display: none;
}
</style>
