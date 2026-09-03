<script setup lang="ts">
// MessageReaderPane — the rightmost reading column: header actions
// (back/reply/star/read/move/delete), meta rows, and the sanitized body.
//
// The header actions use a priority overflow (@fluentui/priority-overflow):
// every action is a labelled button in a single flex row, and as the pane
// narrows the lowest-priority actions automatically fold into a "…" menu
// (reply/forward have the highest priority and stay visible longest). The
// overflow manager measures the action row's own width (not the viewport,
// since the sidebar + list can squeeze the pane on any screen size). The "…"
// menu itself is positioned by the generic useOverflowMenu; this file only
// maps each action's priority and folds the overflowed ones into that menu.
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  useTemplateRef,
  watch,
  type Component,
} from "vue";
import { createOverflowManager } from "@fluentui/priority-overflow";
import { useRemoteImageControl } from "../../composables/useRemoteImageControl";
import RemoteImagesBanner from "./RemoteImagesBanner.vue";
import type { MessageDetail } from "@shared/types";
import { t, formatDateTime } from "../../lib/i18n";
import { api } from "../../lib/api";
import { formatAttachmentSize } from "../../lib/utils";
import { useOverflowMenu } from "../../composables/useOverflowMenu";
import Button from "../../components/UiButton.vue";
import AppTooltip from "../../components/UiToolTip.vue";
import {
  Star,
  Reply,
  Forward,
  ChevronLeft,
  Paperclip,
  Mail as MailIcon,
  RefreshCw,
  Trash2,
  Loader2,
  FolderInput,
  MoreHorizontal,
} from "@lucide/vue";

const props = defineProps<{
  /** The currently open message detail (null = nothing open). */
  message: MessageDetail | null;
  loading: boolean;
  /** True while the mark-read/mark-unread toggle request is in flight — shows
   *  a spinner inside the toggle button instead of blanking the whole pane. */
  togglingRead: boolean;
  /** True while the star toggle request is in flight — shows a spinner in the
   *  star button and the compact "…" menu item. */
  togglingStar: boolean;
}>();

const emit = defineEmits<{
  back: [];
  reply: [];
  forward: [];
  "toggle-star": [];
  "toggle-read": [];
  "move-message": [];
  "confirm-delete": [];
}>();

/** Actions reachable from the header (map 1:1 to emits). */
type ReaderAction =
  "forward" | "reply" | "toggle-star" | "toggle-read" | "move-message" | "confirm-delete";

/** A header action: icon + text label, plus its overflow priority. */
interface ActionDef {
  key: ReaderAction;
  icon: Component;
  label: () => string;
  /** Higher priority = overflows later (stays visible longer). */
  priority: number;
  danger?: boolean;
}

/** All header actions, in display order. Reply/forward are the most important,
 *  so they get the highest priorities and only fold as a last resort. */
const actions: ActionDef[] = [
  { key: "reply", icon: Reply, label: () => t("message.reply"), priority: 6 },
  { key: "forward", icon: Forward, label: () => t("message.forward"), priority: 5 },
  {
    key: "toggle-star",
    icon: Star,
    label: () => (props.message?.isStarred ? t("message.unstar") : t("message.star")),
    priority: 4,
  },
  {
    key: "toggle-read",
    icon: MailIcon,
    label: () => (props.message?.isRead ? t("message.markUnread") : t("message.markRead")),
    priority: 3,
  },
  { key: "move-message", icon: FolderInput, label: () => t("message.moveTo"), priority: 2 },
  {
    key: "confirm-delete",
    icon: Trash2,
    label: () => t("common.delete"),
    priority: 1,
    danger: true,
  },
];

// ---- mobile "…" action menu (generic anchored menu) ----
const {
  open: moreOpen,
  triggerEl: moreBtnEl,
  menuEl: moreMenuEl,
  pos: morePos,
  toggle: toggleMore,
  close: closeMore,
} = useOverflowMenu();

// ---- priority overflow (@fluentui/priority-overflow) ----
// The manager observes the action row and, from each item's measured width +
// priority, decides which buttons fit and which must fold into the "…" menu.
// Visibility is driven through `itemVisibility` (v-show on each button).
const overflowContainerEl = useTemplateRef<HTMLElement>("overflowContainerEl");
const actionBtnEls = ref<Partial<Record<ReaderAction, HTMLElement | null>>>({});
const itemVisibility = reactive<Record<string, boolean>>(
  Object.fromEntries(actions.map((a) => [a.key, true])),
);
const invisibleIds = ref<string[]>([]);
const overflowVisible = computed(() => invisibleIds.value.length > 0);

let overflowManager: ReturnType<typeof createOverflowManager> | null = null;
let overflowObserving = false;

// Stable per-key ref callbacks (so re-renders don't null out the DOM refs).
const actionRefFns: Record<string, (el: unknown) => void> = {};
function getActionRef(key: ReaderAction) {
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
  if (!props.message) return;
  nextTick(() => {
    // The message may have been deselected while we waited for the DOM.
    if (!props.message || !overflowContainerEl.value) return;
    if (!overflowManager) {
      overflowManager = createOverflowManager({
        overflowDirection: "end",
        padding: 8, // gap between buttons
        onUpdateItemVisibility: ({ item, visible }) => {
          // Apply visibility synchronously (attribute + CSS), as the official
          // contract requires, so the engine's width measurements and the DOM
          // never race; also track the id for the "…" menu contents.
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

// Set up overflow when a message opens; tear down and rebuild when it changes.
watch(
  () => props.message,
  (msg, prev) => {
    if (msg !== prev) {
      teardownOverflow();
      if (msg) setupOverflow();
    }
  },
);
onMounted(() => {
  if (props.message) setupOverflow();
});
onUnmounted(teardownOverflow);

// Re-measure when a button's text/icon width can change (star/read toggling or
// an in-flight spinner replacing an icon) so folding stays correct.
watch(
  [
    () => props.message?.isStarred,
    () => props.message?.isRead,
    () => props.togglingStar,
    () => props.togglingRead,
  ],
  () => nextTick(() => overflowManager?.update()),
);

// Register/unregister the "…" menu button with the manager so its width is
// reserved while items are overflowing (mirrors the official register/unregister
// pattern). When nothing overflows there is no "…" button to open the menu.
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

/** Run an action. Star/read leave the menu open so their in-flight spinner is
 *  visible; the watcher below closes it once the request settles. Everything
 *  else dismisses immediately. */
function runAction(action: ReaderAction) {
  if (action !== "toggle-star" && action !== "toggle-read") closeMore();
  (emit as (e: ReaderAction) => void)(action);
}

/** Whether an action shows an in-flight spinner. */
function spinning(a: ActionDef) {
  return a.key === "toggle-star"
    ? props.togglingStar
    : a.key === "toggle-read"
      ? props.togglingRead
      : false;
}

/** Star icon fill when the message is starred. */
function starFillClass(a: ActionDef) {
  return a.key === "toggle-star" && props.message?.isStarred
    ? "fill-yellow-400 text-yellow-400"
    : "";
}

/** Actions currently folded into the "…" menu (kept in display order). */
const foldedActions = computed(() => actions.filter((a) => !itemVisibility[a.key]));

// When a star/read request started from the menu settles, close the menu that
// was kept open to show its spinner.
watch(
  [() => props.togglingStar, () => props.togglingRead],
  ([star, read], [prevStar, prevRead]) => {
    if ((prevStar && !star) || (prevRead && !read)) closeMore();
  },
);

/** Attachments the user can download (inline images stay embedded in the body). */
const downloadableAttachments = computed(() =>
  (props.message?.attachments ?? []).filter((a) => !a.isInline),
);

// ---- remote-image privacy ----
const {
  sanitized,
  showBanner,
  loadImagesThisTime,
  allowFromSender,
  alwaysAllowImages,
  onMessageChangePush,
} = useRemoteImageControl(() => props.message);
onMessageChangePush(closeMore);
</script>

<template>
  <section
    class="min-w-0 flex-1 flex-col bg-background"
    :class="message || loading ? 'flex' : 'hidden lg:flex'"
  >
    <!-- Loading takes priority: on the first click the route triggers and
         `selected` isn't set yet, so the spinner must show immediately
         instead of the "select a message" placeholder. -->
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      <RefreshCw class="mr-2 h-4 w-4 animate-spin" /> {{ t("common.loading") }}
    </div>
    <div
      v-else-if="!message"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      {{ t("mailbox.selectToRead") }}
    </div>
    <template v-else>
      <header class="flex items-center gap-2 border-b border-border px-5 py-3">
        <AppTooltip :label="t('common.content')" side="bottom">
          <Button variant="ghost" size="icon" class="h-8 w-8 lg:hidden" @click="emit('back')">
            <ChevronLeft class="h-4 w-4" />
          </Button>
        </AppTooltip>
        <div class="min-w-0 max-w-[50%]">
          <h1 class="truncate text-base font-semibold leading-tight">
            {{ message.subject || "(no subject)" }}
          </h1>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span class="font-medium text-foreground">{{
              message.from?.name || message.from?.address
            }}</span>
            <span v-if="message.from?.address" class="text-xs"
              >&lt;{{ message.from.address }}&gt;</span
            >
            <span class="text-xs">{{ formatDateTime(message.receivedAt) }}</span>
          </div>
        </div>
        <!-- Header actions: a priority overflow. Each labelled button is
             measured by @fluentui/priority-overflow; as the row narrows the
             lowest-priority actions fold into the "…" menu below. -->
        <div
          ref="overflowContainerEl"
          class="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden"
        >
          <template v-for="a in actions" :key="a.key">
            <Button
              :ref="getActionRef(a.key)"
              variant="ghost"
              class="h-8 shrink-0 gap-1.5 px-2.5"
              :class="a.danger ? 'text-destructive hover:bg-destructive hover:text-white' : ''"
              :disabled="spinning(a)"
              @click="runAction(a.key)"
            >
              <Loader2 v-if="spinning(a)" class="h-4 w-4 animate-spin" />
              <component :is="a.icon" v-else class="h-4 w-4" :class="starFillClass(a)" />
              <span>{{ a.label() }}</span>
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
                  class="fixed z-100 w-48 rounded-md border border-border bg-popover p-1 shadow-md"
                  :style="
                    morePos ? { left: `${morePos.left}px`, top: `${morePos.top}px` } : undefined
                  "
                >
                  <template v-for="a in foldedActions" :key="a.key">
                    <button
                      role="menuitem"
                      class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm disabled:opacity-50"
                      :class="
                        a.danger
                          ? 'text-destructive hover:bg-destructive hover:text-white'
                          : 'hover:bg-accent hover:text-accent-foreground'
                      "
                      :disabled="spinning(a)"
                      @click="runAction(a.key)"
                    >
                      <Loader2 v-if="spinning(a)" class="h-4 w-4 animate-spin" />
                      <component :is="a.icon" v-else class="h-4 w-4" :class="starFillClass(a)" />
                      {{ a.label() }}
                    </button>
                  </template>
                </div>
              </Transition>
            </Teleport>
          </div>
        </div>
      </header>

      <div
        v-if="message.to.length"
        class="border-b border-border px-5 py-1.5 text-xs text-muted-foreground"
      >
        To:
        <span v-for="(recip, i) in message.to" :key="i"
          >{{ recip.name || recip.address }}<span v-if="i < message.to.length - 1">, </span></span
        >
      </div>
      <div
        v-if="downloadableAttachments.length"
        class="flex flex-wrap gap-2 border-b border-border px-5 py-2"
      >
        <a
          v-for="a in downloadableAttachments"
          :key="a.id"
          :href="api.attachmentUrl(message.id, a.id)"
          :download="a.filename || 'attachment'"
          class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs transition-colors hover:bg-accent"
        >
          <Paperclip class="h-3.5 w-3.5 text-muted-foreground" />
          <span class="max-w-50 truncate">{{ a.filename || "attachment" }}</span>
          <span v-if="a.size > 0" class="text-muted-foreground"
            >({{ formatAttachmentSize(a.size) }})</span
          >
        </a>
      </div>

      <div class="flex-1 overflow-y-auto p-5">
        <RemoteImagesBanner
          v-if="showBanner"
          @load-this-time="loadImagesThisTime"
          @allow-from-sender="allowFromSender"
          @always-allow="alwaysAllowImages"
        />
        <div class="email-body text-[15px]" v-html="sanitized?.html ?? ''" />
      </div>
    </template>
  </section>
</template>

<style scoped>
/* @fluentui/priority-overflow contract: overflowed items must be removed from
   layout synchronously (the engine measures widths while it folds). */
[data-overflowing] {
  display: none;
}
</style>
