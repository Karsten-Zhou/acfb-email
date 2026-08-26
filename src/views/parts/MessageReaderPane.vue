<script setup lang="ts">
// MessageReaderPane — the rightmost reading column: header actions
// (back/reply/star/read/move/delete), meta rows, and the sanitized body.
// When the pane itself is narrow the icon actions collapse behind a "…" menu
// (decided by the pane's measured width, not the viewport, since the sidebar
// + list can squeeze it on any screen size); a roomy pane shows them inline.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { mailState } from "../../stores/mail";
import { sanitizeHtml } from "../../lib/sanitize";
import { t, formatDateTime } from "../../lib/i18n";
import { api } from "../../lib/api";
import { formatAttachmentSize } from "../../lib/utils";
import Button from "../../components/UiButton.vue";
import AppTooltip from "../../components/UiToolTip.vue";
import {
  Star,
  Reply,
  ChevronLeft,
  Paperclip,
  Mail as MailIcon,
  RefreshCw,
  Trash2,
  Loader2,
  FolderInput,
  MoreHorizontal,
} from "lucide-vue-next";

defineProps<{
  loading: boolean;
  /** True while the mark-read/mark-unread toggle request is in flight — shows
   *  a spinner inside the toggle button instead of blanking the whole pane. */
  togglingRead: boolean;
}>();

const emit = defineEmits<{
  back: [];
  reply: [];
  "toggle-star": [];
  "toggle-read": [];
  "move-message": [];
  "confirm-delete": [];
}>();

/** Actions reachable from the mobile "…" menu (map 1:1 to emits). */
type ReaderAction = "reply" | "toggle-star" | "toggle-read" | "move-message" | "confirm-delete";

// ---- mobile "…" action menu ----
const moreOpen = ref(false);
const moreBtnEl = ref<HTMLElement | null>(null);
const moreMenuEl = ref<HTMLElement | null>(null);
const morePos = ref<{ left: number; top: number } | null>(null);

// ---- header layout: inline buttons vs "…" menu ----
// The pane's own width decides which header renders (ResizeObserver on the
// pane, not a viewport breakpoint — the sidebar + list can squeeze the pane
// on any screen size). Starts wide so a roomy header never flashes collapsed.
const paneEl = ref<HTMLElement | null>(null);
const paneWidth = ref(Number.POSITIVE_INFINITY);
/** Below this pane width the action buttons collapse behind the "…" menu. */
const COMPACT_HEADER_PX = 420;
const compactHeader = computed(() => paneWidth.value < COMPACT_HEADER_PX);
let resizeObserver: ResizeObserver | null = null;

// If the pane widens past the threshold while the "…" menu is open, close it.
watch(compactHeader, (compact) => {
  if (!compact) closeMore();
});

async function toggleMore() {
  if (moreOpen.value) {
    closeMore();
    return;
  }
  moreOpen.value = true;
  await nextTick();
  placeMore();
}

function closeMore() {
  moreOpen.value = false;
  morePos.value = null;
}

/** Pin the menu below the trigger, right-aligned so it stays on-screen. */
function placeMore() {
  const btn = moreBtnEl.value;
  const menu = moreMenuEl.value;
  if (!btn || !menu) return;
  const r = btn.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const dropUp = window.innerHeight - r.bottom < mh && r.top > mh;
  const top = dropUp ? r.top - mh - 4 : r.bottom + 4;
  const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
  morePos.value = { left, top };
}

function onDocMouseDown(e: MouseEvent) {
  if (!moreOpen.value) return;
  const target = e.target as Node;
  if (moreBtnEl.value?.contains(target) || moreMenuEl.value?.contains(target)) return;
  closeMore();
}

function onDocKey(e: KeyboardEvent) {
  if (e.key === "Escape") closeMore();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMouseDown);
  window.addEventListener("keydown", onDocKey);
  window.addEventListener("resize", closeMore);
  window.addEventListener("scroll", closeMore, { capture: true, passive: true });
  resizeObserver = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (typeof w === "number") paneWidth.value = w;
  });
  if (paneEl.value) resizeObserver.observe(paneEl.value);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onDocMouseDown);
  window.removeEventListener("keydown", onDocKey);
  window.removeEventListener("resize", closeMore);
  window.removeEventListener("scroll", closeMore, { capture: true });
  resizeObserver?.disconnect();
  resizeObserver = null;
});

/** Run a mobile-menu action (closes the menu, then forwards the emit). */
function runAction(action: ReaderAction) {
  closeMore();
  switch (action) {
    case "reply":
      emit("reply");
      break;
    case "toggle-star":
      emit("toggle-star");
      break;
    case "toggle-read":
      emit("toggle-read");
      break;
    case "move-message":
      emit("move-message");
      break;
    case "confirm-delete":
      emit("confirm-delete");
      break;
  }
}

/** Attachments the user can download (inline images stay embedded in the body). */
const downloadableAttachments = computed(() =>
  (mailState.selected?.attachments ?? []).filter((a) => !a.isInline),
);
</script>

<template>
  <section
    ref="paneEl"
    class="min-w-0 flex-1 flex-col bg-background"
    :class="mailState.selected || loading ? 'flex' : 'hidden lg:flex'"
  >
    <!-- Loading takes priority: on the first click the route triggers and
         `selected` isn't set yet, so the spinner must show immediately
         instead of the "select a message" placeholder. -->
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      <RefreshCw class="mr-2 h-4 w-4 animate-spin" /> {{ t("content") }}…
    </div>
    <div
      v-else-if="!mailState.selected"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      {{ t("selectToRead") }}
    </div>
    <template v-else>
      <header class="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <AppTooltip :label="t('content')" side="bottom">
          <Button variant="ghost" size="icon" class="h-8 w-8 lg:hidden" @click="emit('back')">
            <ChevronLeft class="h-4 w-4" />
          </Button>
        </AppTooltip>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-base font-semibold leading-tight">
            {{ mailState.selected.subject || "(no subject)" }}
          </h1>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span class="font-medium text-foreground">{{
              mailState.selected.from?.name || mailState.selected.from?.address
            }}</span>
            <span v-if="mailState.selected.from?.address" class="text-xs"
              >&lt;{{ mailState.selected.from.address }}&gt;</span
            >
            <span class="text-xs">{{ formatDateTime(mailState.selected.receivedAt) }}</span>
          </div>
        </div>
        <!-- Roomier pane: actions inline. -->
        <div v-if="!compactHeader" class="flex items-center gap-1">
          <AppTooltip :label="t('reply')">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('reply')">
              <Reply class="h-4 w-4" />
            </Button>
          </AppTooltip>
          <AppTooltip :label="t('star')">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('toggle-star')">
              <Star
                class="h-4 w-4"
                :class="mailState.selected.isStarred ? 'fill-yellow-400 text-yellow-400' : ''"
              />
            </Button>
          </AppTooltip>
          <AppTooltip :label="mailState.selected.isRead ? t('markUnread') : t('markRead')">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              :disabled="togglingRead"
              @click="emit('toggle-read')"
            >
              <Loader2 v-if="togglingRead" class="h-4 w-4 animate-spin" />
              <MailIcon v-else class="h-4 w-4" />
            </Button>
          </AppTooltip>
          <AppTooltip :label="t('moveTo')">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('move-message')">
              <FolderInput class="h-4 w-4" />
            </Button>
          </AppTooltip>
          <AppTooltip :label="t('delete')">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-destructive hover:bg-destructive hover:text-white"
              @click="emit('confirm-delete')"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </AppTooltip>
        </div>

        <!-- Narrow pane: collapse the icon group behind a "…" menu so the
             header doesn't crowd. -->
        <div v-if="compactHeader" ref="moreBtnEl" class="relative">
          <AppTooltip :label="t('moreActions')">
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
                v-if="moreOpen"
                ref="moreMenuEl"
                role="menu"
                class="fixed z-100 w-48 rounded-md border border-border bg-popover p-1 shadow-md"
                :style="
                  morePos ? { left: `${morePos.left}px`, top: `${morePos.top}px` } : undefined
                "
              >
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  @click="runAction('reply')"
                >
                  <Reply class="h-4 w-4" /> {{ t("reply") }}
                </button>
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  @click="runAction('toggle-star')"
                >
                  <Star
                    class="h-4 w-4"
                    :class="mailState.selected.isStarred ? 'fill-yellow-400 text-yellow-400' : ''"
                  />
                  {{ mailState.selected.isStarred ? t("unstar") : t("star") }}
                </button>
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  :disabled="togglingRead"
                  @click="runAction('toggle-read')"
                >
                  <Loader2 v-if="togglingRead" class="h-4 w-4 animate-spin" />
                  <MailIcon v-else class="h-4 w-4" />
                  {{ mailState.selected.isRead ? t("markUnread") : t("markRead") }}
                </button>
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  @click="runAction('move-message')"
                >
                  <FolderInput class="h-4 w-4" /> {{ t("moveTo") }}
                </button>
                <div class="my-1 h-px bg-border" />
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive hover:text-white"
                  @click="runAction('confirm-delete')"
                >
                  <Trash2 class="h-4 w-4" /> {{ t("delete") }}
                </button>
              </div>
            </Transition>
          </Teleport>
        </div>
      </header>

      <div
        v-if="mailState.selected.to.length"
        class="border-b border-border px-5 py-1.5 text-xs text-muted-foreground"
      >
        To:
        <span v-for="(recip, i) in mailState.selected.to" :key="i"
          >{{ recip.name || recip.address
          }}<span v-if="i < mailState.selected.to.length - 1">, </span></span
        >
      </div>
      <div
        v-if="downloadableAttachments.length"
        class="flex flex-wrap gap-2 border-b border-border px-5 py-2"
      >
        <a
          v-for="a in downloadableAttachments"
          :key="a.id"
          :href="api.attachmentUrl(mailState.selected.id, a.id)"
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
        <div
          class="email-body text-[15px]"
          v-html="
            sanitizeHtml(mailState.selected.html || mailState.selected.text || '', {
              messageId: mailState.selected.id,
              attachments: mailState.selected.attachments,
            })
          "
        />
      </div>
    </template>
  </section>
</template>
