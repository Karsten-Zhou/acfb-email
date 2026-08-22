<script setup lang="ts">
// Mailbox view — composition root over three panes:
//   MailboxSidebar (accounts + folder tree), MessageListPane (middle column),
//   MessageReaderPane (rightmost reader). Mobile top/bottom bars live here.
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { accountsState, loadAccounts } from "../stores/accounts";
import {
  loadUnified,
  loadMessages,
  deleteMessages,
  updateFlags,
  openMessage,
  mailState,
} from "../stores/mail";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { toastError } from "../stores/toast";
import Button from "../components/UiButton.vue";
import UiDialog from "../components/UiDialog.vue";
import MailboxSidebar from "./parts/MailboxSidebar.vue";
import MessageListPane from "./parts/MessageListPane.vue";
import MessageReaderPane from "./parts/MessageReaderPane.vue";
import { RefreshCw, Plus, Settings, Loader2, Menu, MailOpen } from "lucide-vue-next";
import type { Mailbox, Message } from "@shared/types";

const route = useRoute();
const router = useRouter();
const activeMailboxId = ref<string | null>("unified");
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
const syncingAccountId = ref<string | null>(null);
const loadingMessage = ref(false);
/** Read-toggle in flight: spinner shows on the reader's mark-read button. */
const togglingRead = ref(false);
/** Pull-to-refresh in flight (mobile touch drag). */
const refreshing = ref(false);
/** If set, the confirm dialog targets a single message (from the reading pane). */
const pendingDeleteId = ref<string | null>(null);

const roleLabel: Record<string, string> = {
  inbox: "Inbox",
  all: "All Mail",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
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
  syncingAccountId.value = id;
  syncError.value = null;
  try {
    const res = await api.syncAccount(id);
    if (!res.ok && res.message) {
      syncError.value = res.message;
      toastError(res.message);
    }
    await refresh();
  } finally {
    syncingAccountId.value = null;
  }
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

/** Open a message: desktop reads it in the rightmost pane via the route. */
function openMessageRow(m: Message) {
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
  <div
    class="flex h-full bg-background text-foreground"
    :class="reading ? '' : 'pt-12 md:pt-0'"
  >
    <MailboxSidebar
      :mailboxes="mailboxTree"
      :active-mailbox-id="activeMailboxId"
      :syncing="syncing"
      :syncing-account-id="syncingAccountId"
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
      @back="router.replace('/mail')"
      @reply="replyTo"
      @toggle-star="
        updateFlags([mailState.selected!.id], { starred: !mailState.selected!.isStarred })
      "
      @toggle-read="toggleReadFromReader"
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

    <!-- Mobile compose FAB (replaces the redundant bottom nav — Mail/Settings
         are reachable via the top bar + hamburger, Compose is the one action
         that deserves a dedicated thumb-reachable button). -->
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
  </div>
</template>
