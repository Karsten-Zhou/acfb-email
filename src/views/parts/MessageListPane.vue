<script setup lang="ts">
// MessageListPane — the middle column: header (folder + unread filter + bulk
// actions), sync-error banner, message rows, infinite scroll, pull-to-refresh,
// and an end-of-list footer (loading spinner / "no more messages" line).
import { computed, ref } from "vue";
import { t, formatRelativeDate } from "../../lib/i18n";
import Button from "../../components/UiButton.vue";
import AppTooltip from "../../components/UiToolTip.vue";
import {
  AlertTriangle,
  MailOpen,
  RefreshCw,
  ArrowDownToLine,
  Trash2,
  Mail as MailIcon,
  Star,
  Loader2,
  Paperclip,
  FolderInput,
} from "lucide-vue-next";
import type { Message } from "@shared/types";

const props = defineProps<{
  title: string;
  reading: boolean;
  onlyUnread: boolean;
  syncError: string | null;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  refreshing: boolean;
  selectedId: string | null;
  selectedIds: Set<string>;
  selectedCount: number;
}>();

const emit = defineEmits<{
  toggleUnread: [];
  "mark-read": [];
  "move-selected": [];
  "confirm-delete": [];
  open: [m: Message];
  toggleSelect: [id: string];
  scroll: [e: Event];
  dismissError: [];
  "pull-refresh": [];
}>();

// Action buttons only make sense when there are selected messages.
const actionsVisible = computed(() => props.selectedCount > 0);

// ---- pull-to-refresh (touch) ----
// Drag-down while at the top reveals a pull indicator; releasing past the
// threshold fires `pull-refresh` (the parent runs a sync).
const pullDistance = ref(0);
const PULL_THRESHOLD = 70; // px
const PULL_MAX = 110; // px clamp

let touchStartY = 0;
let touchActive = false;

function onTouchStart(e: TouchEvent) {
  const el = e.currentTarget as HTMLElement;
  if (el.scrollTop <= 0) {
    touchStartY = e.touches[0].clientY;
    touchActive = true;
  }
}

function onTouchMove(e: TouchEvent) {
  if (!touchActive) return;
  const dy = e.touches[0].clientY - touchStartY;
  const el = e.currentTarget as HTMLElement;
  if (el.scrollTop > 0 || dy <= 0) {
    pullDistance.value = 0;
    touchActive = false;
    return;
  }
  pullDistance.value = Math.min(dy, PULL_MAX);
}

function onTouchEnd() {
  if (!touchActive) return;
  touchActive = false;
  if (pullDistance.value >= PULL_THRESHOLD && !props.refreshing) {
    emit("pull-refresh");
  }
  pullDistance.value = 0;
}
</script>

<template>
  <!-- Desktop (lg+): cap the list width so the reading pane gets comfortable
       room (max-w-md ≈ 28rem; more than that doesn't add row readability).
       Below lg the list and reader swap (only one shows beside the sidebar),
       so the list fills the remaining width without a cap. -->
  <section
    class="flex min-w-0 flex-1 flex-col border-r border-border bg-background lg:max-w-md"
    :class="reading ? 'hidden lg:flex' : 'flex'"
  >
    <header
      class="hidden flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 md:flex"
    >
      <h2 class="truncate text-sm font-semibold">{{ title }}</h2>
      <div class="flex items-center gap-1">
        <button
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
          :class="onlyUnread ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
          :title="t('showOnlyUnread')"
          @click="emit('toggleUnread')"
        >
          <MailOpen class="h-3.5 w-3.5" /> {{ t("showOnlyUnread") }}
        </button>
        <Button v-if="actionsVisible" variant="ghost" size="sm" @click="emit('mark-read')">
          {{ t("markRead") }}
        </Button>
        <AppTooltip v-if="actionsVisible" :label="t('moveTo')">
          <Button variant="ghost" size="sm" @click="emit('move-selected')">
            <FolderInput class="h-4 w-4" /> {{ t("move") }}
          </Button>
        </AppTooltip>
        <Button
          v-if="actionsVisible"
          variant="ghost"
          size="sm"
          class="text-destructive"
          @click="emit('confirm-delete')"
        >
          <Trash2 class="h-4 w-4" /> {{ t("delete") }} ({{ selectedCount }})
        </Button>
      </div>
    </header>

    <div
      v-if="syncError"
      class="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
    >
      <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ syncError }}</span>
      <button
        class="shrink-0 rounded px-1 text-destructive/80 hover:bg-destructive/15"
        @click="emit('dismissError')"
      >
        ✕
      </button>
    </div>
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      <RefreshCw class="mr-2 h-4 w-4 animate-spin" /> {{ t("content") }}…
    </div>
    <div
      v-else-if="messages.length === 0"
      class="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground"
    >
      <div>
        <MailIcon class="mx-auto mb-2 h-8 w-8 opacity-40" />
        {{ t("noMessages") }}
      </div>
    </div>
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <!-- Pull-to-refresh indicator: a real block ABOVE the scrollable list
           (not translated inside it), so rows shift down instead of being
           overlapped. Its height follows the drag while pulling; while the
           parent sync runs it keeps a comfortable fixed height. -->
      <div
        class="overflow-hidden"
        :style="{
          height: refreshing ? '2.75rem' : pullDistance > 0 ? `${pullDistance}px` : '0px',
        }"
      >
        <div
          class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground transition-opacity"
          :style="{ opacity: refreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1) }"
        >
          <Loader2 v-if="refreshing" class="h-4 w-4 animate-spin" />
          <ArrowDownToLine
            v-else
            class="h-4 w-4"
            :class="pullDistance >= PULL_THRESHOLD ? 'rotate-180' : ''"
          />
          <span>{{ refreshing ? t("syncing") : t("refreshPull") }}</span>
        </div>
      </div>

      <div
        class="flex-1 divide-y divide-border overflow-y-auto touch-pan-y"
        @scroll="emit('scroll', $event)"
        @touchstart.passive="onTouchStart"
        @touchmove.passive="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <button
          v-for="m in messages"
          :key="m.id"
          class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60"
          :class="[selectedId === m.id ? 'bg-accent' : '', m.isRead ? '' : 'bg-accent/20']"
          @click="emit('open', m)"
        >
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 shrink-0 accent-primary"
            :checked="selectedIds.has(m.id)"
            @click.stop
            @change="emit('toggleSelect', m.id)"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span
                class="truncate text-sm"
                :class="m.isRead ? 'font-normal text-foreground/70' : 'font-semibold'"
              >
                {{ m.from?.name || m.from?.address || "(unknown)" }}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">{{
                formatRelativeDate(m.receivedAt)
              }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="truncate text-sm"
                :class="m.isRead ? 'text-muted-foreground' : 'font-medium'"
              >
                {{ m.subject || "(no subject)" }}
              </span>
              <Star
                v-if="m.isStarred"
                class="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400"
              />
              <Paperclip
                v-if="m.hasAttachments"
                class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            </div>
            <div class="truncate text-xs text-muted-foreground">
              {{ m.snippet }}
            </div>
          </div>
        </button>

        <!-- End-of-list footer: only present when there's something to say —
           a spinner while fetching older, or an explicit "no more messages"
           line once everything is exhausted. Nothing is shown while more
           pages exist but none are being loaded (e.g. at the top of the list). -->
        <div class="flex items-center justify-center border-border bg-background/80 px-4 py-2">
          <div v-if="loadingOlder" class="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 class="h-3.5 w-3.5 animate-spin" />
            {{ t("loadingOlder") }}
          </div>
          <span v-else-if="!hasOlder" class="text-xs text-muted-foreground/70">
            {{ t("noMoreMessages") }}
          </span>
          <!-- a placeholder to avoid UI flash -->
          <span v-else class="text-xs text-muted-foreground/70 invisible">
            {{ t("noMoreMessages") }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
