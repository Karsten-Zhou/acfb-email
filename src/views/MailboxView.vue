<script setup lang="ts">
// Mailbox view — 3-pane desktop layout / stacked mobile.
// Wide screens: sidebar | list | reading pane (message content changes in the
// rightmost column, never a separate page).
// The route /mail/message/:id maps here; on desktop the right pane reads it.
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import DOMPurify from "dompurify";
import { accountsState, loadAccounts } from "../stores/accounts";
import { loadUnified, loadMessages, deleteMessages, updateFlags, openMessage, mailState } from "../stores/mail";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import Button from "../components/ui/button/AppButton.vue";
import {
  Inbox,
  Send,
  FileText,
  Trash2,
  Archive,
  AlertTriangle,
  Star,
  RefreshCw,
  Plus,
  Mail as MailIcon,
  Settings,
  Reply,
  ChevronLeft,
  Paperclip,
  MailOpen,
  Loader2,
} from "lucide-vue-next";
import type { Mailbox, Message } from "@shared/types";

const route = useRoute();
const router = useRouter();
const activeMailboxId = ref<string | null>("unified");
const syncing = ref(false);
const reading = ref(false); // mobile: whether the compact reader is open
const onlyUnread = ref(false);
const loadingOlder = ref(false);
const pageSize = 50;
const hasOlder = ref(true);
const confirmDelete = ref(false);
const deleting = ref(false);
const syncingAccountId = ref<string | null>(null);

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

const mailboxTree = ref<{ accountId: string; accountName: string; accountEmail: string; mailbox: Mailbox }[]>([]);

async function refresh() {
  await loadAccounts();
  const tree: { accountId: string; accountName: string; accountEmail: string; mailbox: Mailbox }[] = [];
  for (const acct of accountsState.accounts) {
    const { mailboxes: boxes } = await api.mailboxes(acct.id);
    for (const b of boxes) {
      tree.push({ accountId: acct.id, accountName: acct.name, accountEmail: acct.email, mailbox: b });
    }
  }
  const order: Record<string, number> = { inbox: 0, all: 1, sent: 2, drafts: 3, archive: 4, spam: 5, trash: 6, other: 100 };
  mailboxTree.value = tree.sort((a, b) => (order[a.mailbox.role] ?? 100) - (order[b.mailbox.role] ?? 100));
  await loadInto();
}

async function loadInto() {
  if (activeMailboxId.value === "unified") await loadUnified();
  else if (activeMailboxId.value) await loadMessages(activeMailboxId.value);
  else mailState.messages = [];
}

async function syncNow() {
  syncing.value = true;
  try {
    await Promise.all(accountsState.accounts.map((a) => api.syncAccount(a.id).catch(() => ({ ok: false }))));
    await refresh();
  } finally {
    syncing.value = false;
  }
}

async function syncAccountNow(id: string) {
  syncingAccountId.value = id;
  try {
    await api.syncAccount(id);
    await refresh();
  } finally {
    syncingAccountId.value = null;
  }
}

function selectMailbox(id: string) {
  activeMailboxId.value = id;
  mailState.selectedIds = new Set();
  hasOlder.value = true;
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
  confirmDelete.value = true;
}

async function doDeleteSelected() {
  deleting.value = true;
  const ids = [...mailState.selectedIds];
  try {
    await deleteMessages(ids);
    mailState.selectedIds = new Set();
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

/** Load an older page (offset paging) into the current list. */
async function loadOlder() {
  if (loadingOlder.value || !hasOlder.value) return;
  loadingOlder.value = true;
  try {
    const offset = mailState.messages.length;
    const incoming =
      activeMailboxId.value === "unified"
        ? await api.unified(pageSize, offset)
        : await api.messages(activeMailboxId.value!, pageSize, offset);
    const seen = new Set(mailState.messages.map((m) => m.id));
    const fresh = incoming.messages.filter((m) => !seen.has(m.id));
    hasOlder.value = incoming.messages.length === pageSize;
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
  router.push({ name: "compose", query: { to: m.from?.address ?? "", subject: m.subject ? `Re: ${m.subject}` : "" } });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const year = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString([], { month: "short", day: "numeric", ...(year ? {} : { year: "numeric" }) });
}

function sanitizeHtml(s: string): string {
  return DOMPurify.sanitize(s);
}

// ---- route-driven reading pane ----
watch(
  () => route.params.id,
  async (id) => {
    if (typeof id === "string" && id) {
      reading.value = true;
      try {
        await openMessage(id);
      } catch {
        mailState.selected = null;
      }
    } else {
      mailState.selected = null;
      reading.value = false;
    }
  },
  { immediate: true },
);

onMounted(refresh);
watch(activeMailboxId, () => loadInto());
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <!-- Sidebar -->
    <aside class="hidden w-64 flex-shrink-0 flex-col border-r border-border bg-card md:flex">
      <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
        <span class="text-sm font-semibold tracking-tight">Mail</span>
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="syncing" @click="syncNow" title="Sync now">
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': syncing }" />
          </Button>
          <Button variant="ghost" size="icon" class="h-8 w-8" @click="router.push({ name: 'settings' })" title="Settings">
            <Settings class="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div class="px-3 py-2">
        <Button class="w-full" variant="default" size="sm" @click="router.push({ name: 'compose' })">
          <Plus class="h-4 w-4" /> Compose
        </Button>
      </div>

      <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        <button
          class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
          :class="activeMailboxId === 'unified' ? 'bg-accent text-accent-foreground' : ''"
          @click="selectMailbox('unified')"
        >
          <MailIcon class="h-4 w-4 shrink-0" />
          <span class="flex-grow text-left">Unified Inbox</span>
        </button>

        <template v-for="acct in accountsState.accounts" :key="acct.id">
          <div class="mt-4 mb-0.5 flex items-center justify-between px-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ acct.name }}
            <button
              class="rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              :title="t('syncNow')"
              :disabled="syncingAccountId === acct.id"
              @click.stop="syncAccountNow(acct.id)"
            >
              <RefreshCw v-if="syncingAccountId === acct.id" class="h-3 w-3 animate-spin" />
              <RefreshCw v-else class="h-3 w-3" />
            </button>
          </div>
          <button
            v-for="item in mailboxTree.filter((t) => t.accountId === acct.id)"
            :key="item.mailbox.id"
            class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
            :class="activeMailboxId === item.mailbox.id ? 'bg-accent text-accent-foreground' : ''"
            @click="selectMailbox(item.mailbox.id)"
          >
            <component :is="roleIcon[item.mailbox.role] || Inbox" class="h-4 w-4 shrink-0" />
            <span class="flex-grow truncate text-left">{{ item.mailbox.name }}</span>
            <span v-if="item.mailbox.unseenMessages" class="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
              {{ item.mailbox.unseenMessages }}
            </span>
          </button>
        </template>
      </nav>
    </aside>

    <!-- Message list -->
    <section
      class="flex min-w-0 flex-1 flex-col border-r border-border bg-background"
      :class="reading ? 'hidden md:flex' : 'flex'"
    >
      <header class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 class="truncate text-sm font-semibold">
          {{ activeMailboxId === 'unified' ? t('unifiedInbox') : roleLabel[mailboxTree.find((t) => t.mailbox.id === activeMailboxId)?.mailbox.role ?? 'inbox'] ?? 'Mailbox' }}
        </h2>
        <div class="flex items-center gap-1">
          <button
            class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
            :class="onlyUnread ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
            :title="t('showOnlyUnread')"
            @click="onlyUnread = !onlyUnread"
          >
            <MailOpen class="h-3.5 w-3.5" /> {{ t('showOnlyUnread') }}
          </button>
          <Button v-if="selectedCount > 0" variant="ghost" size="sm" @click="markSelectedRead">{{ t('markRead') }}</Button>
          <Button v-if="selectedCount > 0" variant="ghost" size="sm" class="text-destructive" @click="confirmDeleteSelected">
            <Trash2 class="h-4 w-4" /> {{ t('delete') }} ({{ selectedCount }})
          </Button>
        </div>
      </header>

      <!-- delete confirm dialog -->
      <div v-if="confirmDelete" class="border-b border-border bg-card px-4 py-3">
        <p class="text-sm">{{ t('confirmDeleteMessages') }}</p>
        <div class="mt-2 flex gap-2">
          <Button variant="destructive" size="sm" :disabled="deleting" @click="doDeleteSelected">
            <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" /> {{ t('ok') }}
          </Button>
          <Button variant="ghost" size="sm" @click="confirmDelete = false">{{ t('cancelAction') }}</Button>
        </div>
      </div>

      <div v-if="mailState.loading" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <RefreshCw class="mr-2 h-4 w-4 animate-spin" /> {{ t('content') }}…
      </div>
      <div v-else-if="visibleMessages.length === 0" class="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        <div>
          <MailIcon class="mx-auto mb-2 h-8 w-8 opacity-40" />
          {{ t('noMessages') }}
        </div>
      </div>
      <div v-else class="flex-1 divide-y divide-border overflow-y-auto" @scroll="onListScroll">
        <button
          v-for="m in visibleMessages"
          :key="m.id"
          class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60"
          :class="[mailState.selected?.id === m.id ? 'bg-accent' : '', m.isRead ? '' : 'bg-accent/20']"
          @click="openMessageRow(m)"
        >
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 shrink-0 accent-primary"
            :checked="mailState.selectedIds.has(m.id)"
            @click.stop
            @change="toggleSelect(m.id)"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-sm" :class="m.isRead ? 'font-normal text-foreground/70' : 'font-semibold'">
                {{ m.from?.name || m.from?.address || '(unknown)' }}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">{{ formatDate(m.receivedAt) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="truncate text-sm" :class="m.isRead ? 'text-muted-foreground' : 'font-medium'">
                {{ m.subject || '(no subject)' }}
              </span>
              <Star v-if="m.isStarred" class="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400" />
            </div>
            <div class="truncate text-xs text-muted-foreground">{{ m.snippet }}</div>
          </div>
        </button>
      </div>
    </section>

    <!-- Reading pane (desktop rightmost column) / compact reader (mobile) -->
    <section
      class="min-w-0 flex-1 flex-col bg-background"
      :class="reading ? 'flex md:flex' : 'hidden md:flex'"
    >
      <div v-if="!mailState.selected" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a message to read it
      </div>
      <template v-else>
        <header class="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Button variant="ghost" size="icon" class="md:hidden" @click="router.replace('/mail')" title="Back to list">
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <div class="min-w-0 flex-1">
            <h1 class="truncate text-base font-semibold leading-tight">{{ mailState.selected.subject || '(no subject)' }}</h1>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span class="font-medium text-foreground">{{ mailState.selected.from?.name || mailState.selected.from?.address }}</span>
              <span v-if="mailState.selected.from?.address" class="text-xs">&lt;{{ mailState.selected.from.address }}&gt;</span>
              <span class="text-xs">{{ formatDate(mailState.selected.receivedAt) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="replyTo" title="Reply">
              <Reply class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              :title="mailState.selected.isStarred ? 'Unstar' : 'Star'"
              @click="updateFlags([mailState.selected.id], { starred: !mailState.selected.isStarred })"
            >
              <Star class="h-4 w-4" :class="mailState.selected.isStarred ? 'fill-yellow-400 text-yellow-400' : ''" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              :title="mailState.selected.isRead ? 'Mark unread' : 'Mark read'"
              @click="updateFlags([mailState.selected.id], { read: !mailState.selected.isRead })"
            >
              <MailIcon class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-destructive"
              title="Delete"
              @click="deleteMessages([mailState.selected.id]); router.replace('/mail')"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div v-if="mailState.selected.to.length" class="border-b border-border px-5 py-1.5 text-xs text-muted-foreground">
          To: <span v-for="(t, i) in mailState.selected.to" :key="i">{{ t.name || t.address }}<span v-if="i < mailState.selected.to.length - 1">, </span></span>
        </div>
        <div v-if="mailState.selected.attachments?.length" class="flex flex-wrap gap-2 border-b border-border px-5 py-2">
          <div
            v-for="a in mailState.selected.attachments"
            :key="a.id"
            class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs"
          >
            <Paperclip class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="max-w-[200px] truncate">{{ a.filename || 'attachment' }}</span>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto px-5 py-5">
          <div class="email-body text-[15px]" v-html="sanitizeHtml(mailState.selected.html || mailState.selected.text || '')" />
        </div>
      </template>
    </section>

    <!-- Mobile top bar (when no message open) -->
    <div v-if="!reading" class="fixed inset-x-0 top-0 z-20 flex items-center justify-between border-b border-border bg-card px-4 py-2 md:hidden">
      <span class="text-sm font-semibold">Mail</span>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="syncing" @click="syncNow"><RefreshCw class="h-4 w-4" :class="{ 'animate-spin': syncing }" /></Button>
        <Button variant="ghost" size="icon" class="h-8 w-8" @click="router.push({ name: 'settings' })"><Settings class="h-4 w-4" /></Button>
      </div>
    </div>

    <!-- Mobile bottom nav -->
    <nav class="fixed inset-x-0 bottom-0 z-20 flex items-center justify-around border-t border-border bg-card py-1.5 md:hidden">
      <button class="flex flex-col items-center gap-0.5 px-4 py-1 text-xs text-foreground/70" @click="router.push({ name: 'mailbox' })">
        <MailIcon class="h-5 w-5" /> Mail
      </button>
      <button class="flex flex-col items-center gap-0.5 px-4 py-1 text-xs text-primary" @click="router.push({ name: 'compose' })">
        <Plus class="h-5 w-5" /> Compose
      </button>
      <button class="flex flex-col items-center gap-0.5 px-4 py-1 text-xs text-foreground/70" @click="router.push({ name: 'settings' })">
        <Settings class="h-5 w-5" /> Settings
      </button>
    </nav>
  </div>
</template>