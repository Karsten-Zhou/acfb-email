<script setup lang="ts">
// Mailbox view — composition root over three panes:
//   MailboxSidebar (accounts + folder tree), MessageListPane (middle column),
//   MessageReaderPane (rightmost reader). Mobile top/bottom bars live here.
// Domain logic lives in composables: useMessageActions (selection, move /
// delete / read / star) and useMailboxSync (sync orchestration). This file
// wires server state, route-driven state, and the message-list derived data
// into those panes.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAccounts, useMailboxTree } from "../stores/accounts";
import {
  useMessages,
  useUnified,
  useMessage,
  useUpdateFlags,
  flattenMessages,
} from "../stores/mail";
import { t } from "../lib/i18n";
import { roleLabel } from "../lib/roles";
import { useMessageActions } from "../composables/useMessageActions";
import { useMailboxSync } from "../composables/useMailboxSync";
import Button from "../components/UiButton.vue";
import UiDialog from "../components/UiDialog.vue";
import MailboxSidebar from "./parts/MailboxSidebar.vue";
import MessageListPane from "./parts/MessageListPane.vue";
import MessageReaderPane from "./parts/MessageReaderPane.vue";
import BulkActions from "../components/BulkActions.vue";
import {
  RefreshCw,
  Plus,
  Settings,
  Loader2,
  Menu,
  MailOpen,
  Inbox,
  Send,
  FileText,
  Archive,
  AlertTriangle,
  Trash2,
  Mail as MailIcon,
} from "@lucide/vue";
import type { Mailbox, Message } from "@shared/types";

const route = useRoute();
const router = useRouter();
/** Initial mailbox from the URL (?mailbox=…) — e.g. after composing, land the
 *  user on the account's Sent folder to see the just-sent mail. */
const initialMailbox = typeof route.query.mailbox === "string" ? route.query.mailbox : "";
const activeMailboxId = ref<string | null>(initialMailbox || "unified");
/** Mobile drawer: whether the folder sidebar is open (only below md). */
const sidebarOpen = ref(false);
const reading = ref(false); // mobile: whether the compact reader is open
const onlyUnread = ref(false);

// ---- server state (TanStack Query) ----
const accountsQuery = useAccounts();
const mailboxTreeQuery = useMailboxTree();
const mailboxTree = computed(() => mailboxTreeQuery.data.value ?? []);
const mailboxMessages = useMessages(computed(() => activeMailboxId.value ?? ""));
const unifiedMessages = useUnified();
const messagesQuery = computed(() =>
  activeMailboxId.value === "unified" ? unifiedMessages : mailboxMessages,
);
const messages = computed(() => flattenMessages(messagesQuery.value));
const listLoading = computed(() => messagesQuery.value.isLoading.value);
const loadingOlder = computed(() => messagesQuery.value.isFetchingNextPage.value);
const hasOlder = computed(() => messagesQuery.value.hasNextPage.value);
const routeId = computed(() => (typeof route.params.id === "string" ? route.params.id : undefined));
const readingMailboxId = computed(() =>
  activeMailboxId.value && activeMailboxId.value !== "unified" ? activeMailboxId.value : undefined,
);
const messageQuery = useMessage(routeId, readingMailboxId);
const selected = computed(() => messageQuery.data.value ?? null);
const loadingMessage = computed(() => messageQuery.isLoading.value);

const { mutate: updateFlags } = useUpdateFlags();

// ---- domain composables ----
const actions = useMessageActions({
  getMessages: () => messages.value,
  getMailboxTree: () => mailboxTree.value,
  getSelected: () => selected.value,
  route,
  router,
});
const {
  selectedIds,
  selectedCount,
  confirmDelete,
  confirmMove,
  moving,
  deleting,
  togglingRead,
  togglingStar,
  moveTargetMailboxes,
  toggleSelect,
  markSelectedRead,
  confirmDeleteSelected,
  confirmDeleteOne,
  doDeleteSelected,
  openMoveSelected,
  openMoveMessage,
  doMove,
  toggleReadFromReader,
  toggleStar,
  clearSelection,
} = actions;

const { syncing, syncError, refreshing, syncNow, pullRefresh, syncAccountNow } = useMailboxSync({
  getAccountIds: () => (accountsQuery.data.value ?? []).map((a) => a.id),
  refetchMessages: () => messagesQuery.value.refetch(),
});

const roleIcon: Record<string, typeof Inbox> = {
  inbox: Inbox,
  all: MailIcon,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  spam: AlertTriangle,
  trash: Trash2,
};

/**
 * Unread count per mailbox, derived from *loaded* messages so badges react
 * instantly to read/unread/delete/move. For mailboxes whose messages aren't
 * currently loaded we fall back to the server aggregate (`unseenMessages`).
 */
const unreadByMailbox = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {};
  for (const m of messages.value) {
    if (!m.isRead) counts[m.mailboxId] = (counts[m.mailboxId] ?? 0) + 1;
  }
  return counts;
});

function selectMailbox(id: string) {
  activeMailboxId.value = id;
  clearSelection();
  sidebarOpen.value = false; // close the mobile drawer after picking a folder
  // Clear any open message when switching folders.
  if (route.params.id) void router.replace("/mail");
  // The messages query re-keys off activeMailboxId and fetches the new folder.
}

/** Open a message: desktop reads it in the rightmost pane via the route.
 *  Drafts in the Drafts folder open in the Compose editor instead, so the
 *  user can continue editing them. */
function openMessageRow(m: Message) {
  const box = mailboxTree.value.find((t) => t.mailbox.id === m.mailboxId);
  if (box?.mailbox.role === "drafts") {
    void router.push({ name: "compose-draft", params: { draftId: m.id } });
    return;
  }
  void router.push({ name: "message", params: { id: m.id } });
  reading.value = true; // mobile: show the compact reader
}

/** Messages after applying the "only unread" filter. */
const visibleMessages = computed(() => {
  if (!onlyUnread.value) return messages.value;
  return messages.value.filter((m) => !m.isRead);
});

/** Sidebar badge: derived from loaded messages when available, else server aggregate. */
function unreadBadge(item: { mailbox: Mailbox }): number {
  const loaded = unreadByMailbox.value[item.mailbox.id];
  if (loaded !== undefined) return loaded;
  return item.mailbox.unseenMessages ?? 0;
}

/** Fetch the next older page into the current list (infinite scroll). */
async function loadOlder() {
  if (loadingOlder.value || !hasOlder.value) return;
  await messagesQuery.value.fetchNextPage();
}

/** Infinite-scroll trigger: when scrolled near the bottom. */
function onListScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) void loadOlder();
}

function replyTo() {
  const m = selected.value;
  if (!m) return;
  void router.push({
    name: "compose",
    query: { to: m.from?.address ?? "", subject: m.subject ? `Re: ${m.subject}` : "" },
  });
}

function forward() {
  const m = selected.value;
  if (!m) return;
  void router.push({ name: "compose", query: { forward: m.id } });
}

// ---- route-driven reading pane ----
// Toggle the mobile reader on/off as the route enters/leaves a message. The
// detail itself is loaded by messageQuery above (keyed off the route id).
watch(
  () => route.params.id,
  (id) => {
    reading.value = typeof id === "string" && !!id;
  },
  { immediate: true },
);

// Auto-mark a message read when it is opened via the route. Tracked per
// message id so it fires once per open (not on every cache refetch), and reset
// when leaving a message so reopening an unread one re-marks it.
const autoReadHandledId = ref<string | null>(null);
watch(
  () => route.params.id,
  (id) => {
    if (typeof id !== "string") autoReadHandledId.value = null;
  },
);
watch(messageQuery.data, (m) => {
  if (!m) return;
  if (autoReadHandledId.value === m.id) return;
  if (typeof route.params.id !== "string" || route.params.id !== m.id) return;
  if (m.isRead) return;
  autoReadHandledId.value = m.id;
  updateFlags({ ids: [m.id], flags: { read: true } });
});

// Support ?mailbox=<id> deep links (e.g. land on the Sent folder after send).
watch(
  () => route.query.mailbox,
  (q) => {
    const id = typeof q === "string" ? q : "";
    if (id && id !== activeMailboxId.value) {
      activeMailboxId.value = id;
      clearSelection();
    }
  },
);

const listTitle = computed(() => {
  if (activeMailboxId.value === "unified") return t("mailbox.unifiedInbox");
  const item = mailboxTree.value.find((t) => t.mailbox.id === activeMailboxId.value);
  return roleLabel(item?.mailbox.role) ?? item?.mailbox.name ?? "Mailbox";
});
</script>

<template>
  <!-- Mobile: the fixed top bar overlays the top of the window (it's
       `v-if=!reading`), so pad the layout on small screens while the bar is
       shown to keep the first list row below it. -->
  <div class="flex h-full bg-background text-foreground" :class="reading ? '' : 'pt-12 md:pt-0'">
    <MailboxSidebar
      :mailboxes="mailboxTree"
      :active-mailbox-id="activeMailboxId"
      :syncing="syncing"
      :unread="unreadBadge"
      :open="sidebarOpen"
      @select="selectMailbox"
      @sync-all="syncNow"
      @sync-account="syncAccountNow"
      @close="sidebarOpen = false"
    />

    <MessageListPane
      :title="listTitle"
      :reading="reading"
      :only-unread="onlyUnread"
      :sync-error="syncError"
      :messages="visibleMessages"
      :loading="listLoading"
      :loading-older="loadingOlder"
      :has-older="hasOlder"
      :refreshing="refreshing"
      :selected-id="selected?.id ?? null"
      :selected-ids="selectedIds"
      :selected-count="selectedCount"
      @toggle-unread="onlyUnread = !onlyUnread"
      @mark-read="markSelectedRead"
      @move-selected="openMoveSelected"
      @confirm-delete="confirmDeleteSelected"
      @open="openMessageRow"
      @toggle-select="toggleSelect"
      @scroll="onListScroll"
      @dismiss-error="syncError = null"
      @pull-refresh="pullRefresh"
    />

    <MessageReaderPane
      :message="selected"
      :loading="loadingMessage"
      :toggling-read="togglingRead"
      :toggling-star="togglingStar"
      @back="router.replace('/mail')"
      @reply="replyTo"
      @forward="forward"
      @toggle-star="toggleStar"
      @toggle-read="toggleReadFromReader"
      @move-message="openMoveMessage(selected!.id)"
      @confirm-delete="confirmDeleteOne(selected!.id)"
    />

    <!-- Mobile top bar (when no message open) -->
    <div
      v-if="!reading"
      class="fixed inset-x-0 top-0 z-20 flex items-center justify-between border-b border-border bg-card px-4 py-2 md:hidden"
    >
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :aria-label="t('accounts.emailAccounts')"
          @click="sidebarOpen = true"
          ><Menu class="h-4 w-4"
        /></Button>
        <span v-if="selectedCount > 0" class="text-sm font-semibold">
          {{ selectedCount }} {{ t("common.selected") }}
        </span>
        <span v-else class="text-sm font-semibold">Mail</span>
      </div>
      <div class="flex items-center gap-1">
        <template v-if="selectedCount > 0">
          <BulkActions
            :selected-count="selectedCount"
            @mark-read="markSelectedRead"
            @move="openMoveSelected"
            @delete="confirmDeleteSelected"
          />
        </template>
        <template v-else>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            :class="onlyUnread ? 'bg-accent text-accent-foreground' : ''"
            :aria-label="t('mailbox.showOnlyUnread')"
            @click="onlyUnread = !onlyUnread"
            ><MailOpen class="h-4 w-4"
          /></Button>
          <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="syncing" @click="syncNow"
            ><RefreshCw class="h-4 w-4" :class="{ 'animate-spin': syncing }"
          /></Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            @click="router.push({ name: 'settings' })"
            ><Settings class="h-4 w-4"
          /></Button>
        </template>
      </div>
    </div>

    <!-- Mobile compose FAB -->
    <button
      v-if="!reading"
      class="fixed bottom-4 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 md:hidden"
      :aria-label="t('common.compose')"
      @click="router.push({ name: 'compose' })"
    >
      <Plus class="h-6 w-6" />
    </button>

    <!-- Modal delete confirmation -->
    <UiDialog
      :open="confirmDelete"
      :title="t('message.confirmDeleteMessages')"
      :busy="deleting"
      @close="confirmDelete = false"
    >
      <p class="text-sm text-muted-foreground">{{ t("message.confirmDeleteMessages") }}</p>
      <template #footer>
        <Button variant="ghost" size="sm" :disabled="deleting" @click="confirmDelete = false">{{
          t("common.cancelAction")
        }}</Button>
        <Button variant="destructive" size="sm" :disabled="deleting" @click="doDeleteSelected">
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" /> {{ t("common.ok") }}
        </Button>
      </template>
    </UiDialog>

    <!-- Modal: move to folder -->
    <UiDialog
      :open="confirmMove"
      :title="t('message.moveTo')"
      :busy="moving"
      max-width-class="max-w-md"
      @close="confirmMove = false"
    >
      <p class="mb-2 text-sm text-muted-foreground">{{ t("message.moveToHint") }}</p>
      <div v-if="moving" class="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" /> {{ t("message.moving") }}
      </div>
      <div class="max-h-64 space-y-0.5 overflow-y-auto">
        <button
          v-for="item in moveTargetMailboxes"
          :key="item.mailbox.id"
          class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          :disabled="moving"
          @click="doMove(item.mailbox.id)"
        >
          <component
            :is="roleIcon[item.mailbox.role] || Inbox"
            class="h-4 w-4 shrink-0 text-muted-foreground"
          />
          <span class="min-w-0 flex-1 truncate">{{
            roleLabel(item.mailbox.role) ?? item.mailbox.name
          }}</span>
        </button>
      </div>
      <template #footer>
        <Button variant="ghost" size="sm" :disabled="moving" @click="confirmMove = false">{{
          t("common.cancelAction")
        }}</Button>
      </template>
    </UiDialog>
  </div>
</template>
