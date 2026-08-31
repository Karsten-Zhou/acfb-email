<script setup lang="ts">
// MessageReaderPane — the rightmost reading column: header actions
// (back/reply/star/read/move/delete), meta rows, and the sanitized body.
// When the pane itself is narrow the icon actions collapse behind a "…" menu
// (decided by the pane's measured width, not the viewport, since the sidebar
// + list can squeeze it on any screen size); a roomy pane shows them inline.
// The "…" menu itself is a generic useOverflowMenu; this file only decides
// which header renders (ResizeObserver on the pane) and maps actions to emits.
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
  "toggle-star": [];
  "toggle-read": [];
  "move-message": [];
  "confirm-delete": [];
}>();

/** Actions reachable from the mobile "…" menu (map 1:1 to emits). */
type ReaderAction = "reply" | "toggle-star" | "toggle-read" | "move-message" | "confirm-delete";

// ---- mobile "…" action menu (generic anchored menu) ----
const {
  open: moreOpen,
  triggerEl: moreBtnEl,
  menuEl: moreMenuEl,
  pos: morePos,
  toggle: toggleMore,
  close: closeMore,
} = useOverflowMenu();

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

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (typeof w === "number") paneWidth.value = w;
  });
  if (paneEl.value) resizeObserver.observe(paneEl.value);
});
onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

/** Run a mobile-menu action. Star/read leave the menu open so their in-flight
 *  spinner is visible; the watcher below closes it once the request settles.
 *  Everything else dismisses immediately. */
function runAction(action: ReaderAction) {
  switch (action) {
    case "toggle-star":
    case "toggle-read":
      break;
    default:
      closeMore();
  }
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
    ref="paneEl"
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
      <header class="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <AppTooltip :label="t('common.content')" side="bottom">
          <Button variant="ghost" size="icon" class="h-8 w-8 lg:hidden" @click="emit('back')">
            <ChevronLeft class="h-4 w-4" />
          </Button>
        </AppTooltip>
        <div class="min-w-0 flex-1">
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
        <!-- Roomier pane: actions inline. -->
        <div v-if="!compactHeader" class="flex items-center gap-1">
          <AppTooltip :label="t('message.reply')">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('reply')">
              <Reply class="h-4 w-4" />
            </Button>
          </AppTooltip>
          <AppTooltip :label="t('message.star')">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              :disabled="togglingStar"
              @click="emit('toggle-star')"
            >
              <Loader2 v-if="togglingStar" class="h-4 w-4 animate-spin" />
              <Star
                v-else
                class="h-4 w-4"
                :class="message.isStarred ? 'fill-yellow-400 text-yellow-400' : ''"
              />
            </Button>
          </AppTooltip>
          <AppTooltip :label="message.isRead ? t('message.markUnread') : t('message.markRead')">
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
          <AppTooltip :label="t('message.moveTo')">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('move-message')">
              <FolderInput class="h-4 w-4" />
            </Button>
          </AppTooltip>
          <AppTooltip :label="t('common.delete')">
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
                  <Reply class="h-4 w-4" /> {{ t("message.reply") }}
                </button>
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  :disabled="togglingStar"
                  @click="runAction('toggle-star')"
                >
                  <Loader2 v-if="togglingStar" class="h-4 w-4 animate-spin" />
                  <Star
                    v-else
                    class="h-4 w-4"
                    :class="message.isStarred ? 'fill-yellow-400 text-yellow-400' : ''"
                  />
                  {{ message.isStarred ? t("message.unstar") : t("message.star") }}
                </button>
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  :disabled="togglingRead"
                  @click="runAction('toggle-read')"
                >
                  <Loader2 v-if="togglingRead" class="h-4 w-4 animate-spin" />
                  <MailIcon v-else class="h-4 w-4" />
                  {{ message.isRead ? t("message.markUnread") : t("message.markRead") }}
                </button>
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  @click="runAction('move-message')"
                >
                  <FolderInput class="h-4 w-4" /> {{ t("message.moveTo") }}
                </button>
                <div class="my-1 h-px bg-border" />
                <button
                  role="menuitem"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive hover:text-white"
                  @click="runAction('confirm-delete')"
                >
                  <Trash2 class="h-4 w-4" /> {{ t("common.delete") }}
                </button>
              </div>
            </Transition>
          </Teleport>
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
