<script setup lang="ts">
// Mailbox view — composition root over three panes:
//   MailboxSidebar (accounts + folder tree), MessageListPane (middle column),
//   MessageReaderPane (rightmost reader). Mobile top/bottom bars live here.
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  accountsState,
  loadAccounts,
  markAccountSyncing,
  clearAccountSyncing,
} from "../stores/accounts";
import {
  loadUnified,
  loadMessages,
  deleteMessages,
  moveMessages,
  updateFlags,
  openMessage,
  mailState,
} from "../stores/mail";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { toastError, toastSuccess } from "../stores/toast";
import Button from "../components/UiButton.vue";
import UiDialog from "../components/UiDialog.vue";
import MailboxSidebar from "./parts/MailboxSidebar.vue";
import MessageListPane from "./parts/MessageListPane.vue";
import MessageReaderPane from "./parts/MessageReaderPane.vue";
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
} from "lucide-vue-next";
import type { Mailbox, Message } from "@shared/types";

const route = useRoute();
const router = useRouter();
/** Initial mailbox from the URL (?mailbox=…) — e.g. after composing, land the
 *  user on the account's Sent folder to see the just-sent mail. */
const initialMailbox = typeof route.query.mailbox === "string" ? route.query.mailbox : "";
const activeMailboxId = ref<string | null>(initialMailbox || "unified");
/** Mobile drawer: whether the folder sidebar is open (only below md). */
const sidebarOpen = ref(false);
const syncing = ref(false);
/** Last sync failure shown in the list-pane banner (null = none). */
const syncError = ref<string | null>(null);
const reading = ref(false); // mobile: whether the compact reader is open
const onlyUnread = ref(false);
const loadingOlder = ref(false);
const pageSize = 50;
const hasOlder = ref(true);
const confirmDelete = ref(false);
const deleting = ref(false);
const loadingMessage = ref(false);
/** Read-toggle in flight: spinner shows on the reader's mark-read button. */
const togglingRead = ref(false);
/** Star-toggle in flight: spinner shows on the reader's star button (and in
 *  the compact "…" menu when the pane is narrow). */
const togglingStar = ref(false);
/** Pull-to-refresh in flight (mobile touch drag). */
const refreshing = ref(false);
/** If set, the confirm dialog targets a single message (from the reading pane). */
const pendingDeleteId = ref<string | null>(null);
/** Move-to-folder dialog: open state + the ids to move when a folder is picked. */
const confirmMove = ref(false);
const moving = ref(false);
const pendingMoveIds = ref<string[]>([]);
/** The account whose mailboxes the move dialog lists (moves stay in-account). */
const moveAccountId = ref<string | null>(null);

const roleLabel: Record<string, string> = {
  inbox: "Inbox",
  all: "All Mail",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};

const roleIcon: Record<string, typeof Inbox> = {
  inbox: Inbox,
  all: MailIcon,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  spam: AlertTriangle,
  trash: Trash2,
};

const mailboxTree = ref<
  { accountId: string; accountName: string; accountEmail: string; mailbox: Mailbox }[]
>([]);

/**
 * Unread count per mailbox, derived from *loaded* messages so badges react
 * instantly to read/unread/delete/move. For mailboxes whose messages aren't
 * currently loaded we fall back to the server aggregate (`unseenMessages`).
 */
const unreadByMailbox = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {};
  for (const m of mailState.messages) {
    if (!m.isRead) counts[m.mailboxId] = (counts[m.mailboxId] ?? 0) + 1;
  }
  return counts;
});

async function refresh() {
  await loadAccounts();
  const tree: { accountId: string; accountName: string; accountEmail: string; mailbox: Mailbox }[] =
    [];
  for (const acct of accountsState.accounts) {
    const { mailboxes: boxes } = await api.mailboxes(acct.id);
    for (const b of boxes) {
      tree.push({
        accountId: acct.id,
        accountName: acct.name,
        accountEmail: acct.email,
        mailbox: b,
      });
    }
  }
  const order: Record<string, number> = {
    inbox: 0,
    all: 1,
    sent: 2,
    drafts: 3,
    archive: 4,
    spam: 5,
    trash: 6,
    other: 100,
  };
  mailboxTree.value = tree.sort(
    (a, b) => (order[a.mailbox.role] ?? 100) - (order[b.mailbox.role] ?? 100),
  );
  await loadInto();
}

async function loadInto() {
  if (activeMailboxId.value === "unified") await loadUnified();
  else if (activeMailboxId.value) await loadMessages(activeMailboxId.value);
  else mailState.messages = [];
}

async function syncNow() {
  syncing.value = true;
  syncError.value = null;
  // Optimistic: mark every account syncing so sidebar spinners appear
  // instantly and the poller switches to 1s cadence for the whole run (the
  // per-account spinners + "Syncing…" follow store state === 'running').
  for (const a of accountsState.accounts) markAccountSyncing(a.id);
  try {
    const results = await Promise.all(
      accountsState.accounts.map((a) =>
        api.syncAccount(a.id).catch(() => ({ ok: false as const, message: undefined })),
      ),
    );
    const failed = results.find((r) => !r.ok);
    if (failed && failed.message) {
      syncError.value = failed.message;
      toastError(failed.message);
    }
    await refresh();
  } finally {
    syncing.value = false;
    // All sync requests resolved — the server has settled each account; drop
    // fast mode so polling returns to the 60s idle cadence.
    clearAccountSyncing();
  }
}

/** Pull-to-refresh: same sync as the toolbar button, with the list spinner. */
async function pullRefresh() {
  refreshing.value = true;
  try {
    await syncNow();
  } finally {
    refreshing.value = false;
  }
}

async function syncAccountNow(id: string) {
  syncError.value = null;
  // Optimistic: the sidebar spinner follows store state (running), set now so
  // it appears instantly and the poller switches to 1s cadence.
  markAccountSyncing(id);
  try {
    const res = await api.syncAccount(id);
    if (!res.ok && res.message) {
      syncError.value = res.message;
      toastError(res.message);
    }
  } finally {
    // Always drop fast mode — on success the server has settled the state and
    // the next poll applies its truth; on failure the state never went
    // 'running' server-side so fast polling must not persist (else 1s forever).
    clearAccountSyncing();
  }
  await refresh();
}

function selectMailbox(id: string) {
  activeMailboxId.value = id;
  mailState.selectedIds = new Set();
  hasOlder.value = true;
  sidebarOpen.value = false; // close the mobile drawer after picking a folder
  // Clear any open message when switching folders.
  if (route.params.id) router.replace("/mail");
  void loadInto();
}

/** Open a message: desktop reads it in the rightmost pane via the route.
 *  Drafts in the Drafts folder open in the Compose editor instead, so the
 *  user can continue editing them. */
function openMessageRow(m: Message) {
  const box = mailboxTree.value.find((t) => t.mailbox.id === m.mailboxId);
  if (box?.mailbox.role === "drafts") {
    router.push({ name: "compose-draft", params: { draftId: m.id } });
    return;
  }
  router.push({ name: "message", params: { id: m.id } });
  reading.value = true; // mobile: show the compact reader
}

function toggleSelect(id: string) {
  const set = new Set(mailState.selectedIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  mailState.selectedIds = set;
}

const selectedCount = computed(() => mailState.selectedIds.size);

async function markSelectedRead() {
  const ids = [...mailState.selectedIds];
  await updateFlags(ids, { read: true });
  mailState.selectedIds = new Set();
}

async function confirmDeleteSelected() {
  pendingDeleteId.value = null;
  confirmDelete.value = true;
}

/** Confirm dialog for a single message (from the reading pane). */
function confirmDeleteOne(id: string) {
  pendingDeleteId.value = id;
  confirmDelete.value = true;
}

async function doDeleteSelected() {
  deleting.value = true;
  const ids = pendingDeleteId.value ? [pendingDeleteId.value] : [...mailState.selectedIds];
  try {
    await deleteMessages(ids);
    if (pendingDeleteId.value) {
      mailState.selected = null;
      pendingDeleteId.value = null;
      if (route.params.id) await router.replace("/mail");
    } else {
      mailState.selectedIds = new Set();
    }
    confirmDelete.value = false;
  } finally {
    deleting.value = false;
  }
}

/** Mailboxes the move dialog offers (same account, minus the pending messages' own folders). */
const moveExcludedMailboxIds = computed(() => {
  const ids = new Set<string>();
  for (const m of mailState.messages) {
    if (pendingMoveIds.value.includes(m.id)) ids.add(m.mailboxId);
  }
  if (mailState.selected && pendingMoveIds.value.includes(mailState.selected.id)) {
    ids.add(mailState.selected.mailboxId);
  }
  return ids;
});

const moveTargetMailboxes = computed(() =>
  mailboxTree.value.filter(
    (item) =>
      item.accountId === moveAccountId.value && !moveExcludedMailboxIds.value.has(item.mailbox.id),
  ),
);

/** Open the move dialog for the bulk selection (all messages must share one account). */
function openMoveSelected() {
  const ids = [...mailState.selectedIds];
  const msgs = mailState.messages.filter((m) => ids.includes(m.id));
  const accounts = new Set(msgs.map((m) => m.accountId));
  if (accounts.size !== 1) {
    toastError(t("moveMixedAccounts"));
    return;
  }
  pendingMoveIds.value = ids;
  moveAccountId.value = [...accounts][0];
  confirmMove.value = true;
}

/** Open the move dialog for a single message (from the reading pane). */
function openMoveMessage(id: string) {
  const m = mailState.selected;
  if (!m) return;
  pendingMoveIds.value = [id];
  moveAccountId.value = m.accountId;
  confirmMove.value = true;
}

/** Move the pending messages into the picked mailbox. */
async function doMove(targetMailboxId: string) {
  if (moving.value || pendingMoveIds.value.length === 0) return;
  moving.value = true;
  try {
    await moveMessages(pendingMoveIds.value, targetMailboxId);
    toastSuccess(t("movedMessages"));
    // If the open reading message was moved, close the reader.
    if (mailState.selected && pendingMoveIds.value.includes(mailState.selected.id)) {
      mailState.selected = null;
      reading.value = false;
      if (route.params.id) await router.replace("/mail");
    }
    mailState.selectedIds = new Set();
    confirmMove.value = false;
  } finally {
    moving.value = false;
  }
}

/** Messages after applying the "only unread" filter. */
const visibleMessages = computed(() => {
  if (!onlyUnread.value) return mailState.messages;
  return mailState.messages.filter((m) => !m.isRead);
});

/** Sidebar badge: derived from loaded messages when available, else server aggregate. */
function unreadBadge(item: { mailbox: Mailbox }): number {
  const loaded = unreadByMailbox.value[item.mailbox.id];
  if (loaded !== undefined) return loaded;
  return item.mailbox.unseenMessages ?? 0;
}

/** Load an older page (offset paging) into the current list. */
async function loadOlder() {
  if (loadingOlder.value || !hasOlder.value) return;
  loadingOlder.value = true;
  try {
    const offset = mailState.messages.length;
    // Oldest remote UID + oldest receivedAt in the currently loaded set = the
    // "before" cursors so the route can fetch even older messages from the
    // provider when the local DB page is exhausted.
    const remoteUids = mailState.messages.map((m) => m.remoteUid).filter((x): x is number => !!x);
    const beforeUid = remoteUids.length ? Math.min(...remoteUids) : 0;
    const dates = mailState.messages
      .map((m) => new Date(m.receivedAt).getTime())
      .filter((n) => !Number.isNaN(n));
    const beforeDate = dates.length ? Math.min(...dates) : 0;
    const incoming =
      activeMailboxId.value === "unified"
        ? await api.unified(pageSize, offset)
        : await api.messages(activeMailboxId.value!, pageSize, offset, beforeUid, beforeDate);
    const seen = new Set(mailState.messages.map((m) => m.id));
    const fresh = incoming.messages.filter((m) => !seen.has(m.id));
    hasOlder.value = incoming.messages.length === pageSize;
    // When the local DB page is short but the server says the provider still
    // has older mail (it imported some), allow another scroll to import more.
    if (incoming.messages.length < pageSize && incoming.hasMore) hasOlder.value = true;
    mailState.messages = [...mailState.messages, ...fresh];
  } finally {
    loadingOlder.value = false;
  }
}

/** Infinite-scroll trigger: when scrolled near the bottom. */
function onListScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) void loadOlder();
}

function replyTo() {
  const m = mailState.selected;
  if (!m) return;
  router.push({
    name: "compose",
    query: { to: m.from?.address ?? "", subject: m.subject ? `Re: ${m.subject}` : "" },
  });
}

/**
 * Toggle read/unread from the reader. When marking a message *unread*, on
 * success deselect it (close the reader) so it disappears from the read view
 * and stays visible in the unread filter. Shows a loading state while the
 * flag update is in flight.
 */
async function toggleReadFromReader() {
  const m = mailState.selected;
  if (!m) return;
  togglingRead.value = true;
  try {
    // Toggle: the new desired read flag.
    const newRead = !m.isRead;
    await updateFlags([m.id], { read: newRead });
    // If the message *became unread*, close the reader so the changed entry
    // is only visible in the list (bolded, unread count bumped). If it became
    // read, keep it open as usual.
    if (!newRead) {
      // Navigate FIRST so the route watch clears the selection cleanly and
      // never re-opens the (now unread) message with a stale id — that would
      // re-run openMessage which auto-marks it read again.
      if (route.params.id) await router.replace("/mail");
      mailState.selected = null;
      reading.value = false;
    }
  } finally {
    togglingRead.value = false;
  }
}

/** Toggle star/unstar on the open reading message. Shows a spinner on the
 *  reader's star button (and in the compact "…" menu) while in flight. */
async function toggleStar() {
  const m = mailState.selected;
  if (!m) return;
  togglingStar.value = true;
  try {
    await updateFlags([m.id], { starred: !m.isStarred });
  } finally {
    togglingStar.value = false;
  }
}

// ---- route-driven reading pane ----
watch(
  () => route.params.id,
  async (id) => {
    if (typeof id === "string" && id) {
      reading.value = true;
      loadingMessage.value = true;
      try {
        await openMessage(id);
      } catch {
        mailState.selected = null;
      } finally {
        loadingMessage.value = false;
      }
    } else {
      mailState.selected = null;
      reading.value = false;
      loadingMessage.value = false;
    }
  },
  { immediate: true },
);

onMounted(refresh);
watch(activeMailboxId, () => loadInto());
// Support ?mailbox=<id> deep links (e.g. land on the Sent folder after send).
watch(
  () => route.query.mailbox,
  (q) => {
    const id = typeof q === "string" ? q : "";
    if (id && id !== activeMailboxId.value) {
      activeMailboxId.value = id;
      mailState.selectedIds = new Set();
      hasOlder.value = true;
      void loadInto();
    }
  },
);

const listTitle = computed(() => {
  if (activeMailboxId.value === "unified") return t("unifiedInbox");
  const item = mailboxTree.value.find((t) => t.mailbox.id === activeMailboxId.value);
  return roleLabel[item?.mailbox.role ?? "inbox"] ?? item?.mailbox.name ?? "Mailbox";
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
      :loading="mailState.loading"
      :loading-older="loadingOlder"
      :has-older="hasOlder"
      :refreshing="refreshing"
      :selected-id="mailState.selected?.id ?? null"
      :selected-ids="mailState.selectedIds"
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
      :loading="loadingMessage"
      :toggling-read="togglingRead"
      :toggling-star="togglingStar"
      @back="router.replace('/mail')"
      @reply="replyTo"
      @toggle-star="toggleStar"
      @toggle-read="toggleReadFromReader"
      @move-message="openMoveMessage(mailState.selected!.id)"
      @confirm-delete="confirmDeleteOne(mailState.selected!.id)"
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
          :aria-label="t('emailAccounts')"
          @click="sidebarOpen = true"
          ><Menu class="h-4 w-4"
        /></Button>
        <span class="text-sm font-semibold">Mail</span>
      </div>
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :class="onlyUnread ? 'bg-accent text-accent-foreground' : ''"
          :aria-label="t('showOnlyUnread')"
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
      </div>
    </div>

    <!-- Mobile compose FAB -->
    <button
      v-if="!reading"
      class="fixed bottom-4 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 md:hidden"
      :aria-label="t('compose')"
      @click="router.push({ name: 'compose' })"
    >
      <Plus class="h-6 w-6" />
    </button>

    <!-- Modal delete confirmation -->
    <UiDialog
      :open="confirmDelete"
      :title="t('confirmDeleteMessages')"
      :busy="deleting"
      @close="confirmDelete = false"
    >
      <p class="text-sm text-muted-foreground">{{ t("confirmDeleteMessages") }}</p>
      <template #footer>
        <Button variant="ghost" size="sm" :disabled="deleting" @click="confirmDelete = false">{{
          t("cancelAction")
        }}</Button>
        <Button variant="destructive" size="sm" :disabled="deleting" @click="doDeleteSelected">
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" /> {{ t("ok") }}
        </Button>
      </template>
    </UiDialog>

    <!-- Modal: move to folder -->
    <UiDialog
      :open="confirmMove"
      :title="t('moveTo')"
      :busy="moving"
      max-width-class="max-w-md"
      @close="confirmMove = false"
    >
      <p class="mb-2 text-sm text-muted-foreground">{{ t("moveToHint") }}</p>
      <div v-if="moving" class="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" /> {{ t("moving") }}
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
          <span class="min-w-0 flex-1 truncate">{{ item.mailbox.name }}</span>
        </button>
      </div>
      <template #footer>
        <Button variant="ghost" size="sm" :disabled="moving" @click="confirmMove = false">{{
          t("cancelAction")
        }}</Button>
      </template>
    </UiDialog>
  </div>
</template>
