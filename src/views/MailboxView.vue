<script setup lang="ts">
// Mailbox view: 3-pane layout (desktop) / stacked nav (mobile).
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DOMPurify from "dompurify";
import { accountsState, loadAccounts } from "../stores/accounts";
import { loadUnified, loadMessages, deleteMessages, updateFlags, mailState } from "../stores/mail";
import { api } from "../lib/api";
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
} from "lucide-vue-next";
import type { Mailbox } from "@shared/types";

const router = useRouter();
const activeMailboxId = ref<string | null>("unified");
const syncing = ref(false);

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

// mailboxTree: per-account mailboxes, loaded from server
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

function selectMailbox(id: string) {
  activeMailboxId.value = id;
  mailState.selectedIds = new Set();
  void loadInto();
}

function openMessageById(m: { id: string }) {
  router.push({ name: "message", params: { id: m.id } });
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

async function deleteSelected() {
  const ids = [...mailState.selectedIds];
  await deleteMessages(ids);
  mailState.selectedIds = new Set();
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
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function sanitizeHtml(s: string): string {
  return DOMPurify.sanitize(s);
}

onMounted(refresh);
watch(activeMailboxId, () => loadInto());
</script>

<template>
  <div class="flex h-full">
    <!-- Sidebar -->
    <aside class="hidden w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 md:flex">
      <div class="p-4">
        <button
          class="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
          @click="router.push({ name: 'compose' })"
        >
          <Plus class="h-4 w-4" /> Compose
        </button>
        <button
          class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          @click="syncNow"
          :disabled="syncing"
        >
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': syncing }" /> {{ syncing ? "Syncing…" : "Sync now" }}
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto px-2 pb-4">
        <button
          class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"
          :class="activeMailboxId === 'unified' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : ''"
          @click="selectMailbox('unified')"
        >
          <MailIcon class="h-4 w-4" />
          <span class="flex-grow text-left">Unified Inbox</span>
        </button>

        <template v-for="acct in accountsState.accounts" :key="acct.id">
          <div class="mb-1 mt-4 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {{ acct.name }} <span class="ml-1 font-normal normal-case">{{ acct.email }}</span>
          </div>
          <button
            v-for="item in mailboxTree.filter((t) => t.accountId === acct.id)"
            :key="item.mailbox.id"
            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
            :class="activeMailboxId === item.mailbox.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : ''"
            @click="selectMailbox(item.mailbox.id)"
          >
            <component :is="roleIcon[item.mailbox.role] || Inbox" class="h-4 w-4" />
            <span class="flex-grow truncate text-left">{{ item.mailbox.name }}</span>
            <span v-if="item.mailbox.unseenMessages" class="rounded-full bg-blue-600 px-1.5 py-0.5 text-xs text-white">
              {{ item.mailbox.unseenMessages }}
            </span>
          </button>
        </template>
      </nav>

      <div class="border-t border-slate-200 p-3 dark:border-slate-800">
        <button
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
          @click="router.push({ name: 'settings' })"
        >
          <Settings class="h-4 w-4" /> Settings
        </button>
      </div>
    </aside>

    <!-- Message list -->
    <section class="flex min-w-0 flex-1 flex-col border-r border-slate-200 dark:border-slate-800">
      <header class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 class="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
          {{ activeMailboxId === 'unified' ? 'Unified Inbox' : roleLabel[mailboxTree.find((t) => t.mailbox.id === activeMailboxId)?.mailbox.role ?? 'inbox'] ?? 'Mailbox' }}
        </h2>
        <div class="flex gap-2">
          <button
            v-if="selectedCount > 0"
            class="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
            @click="markSelectedRead"
          >
            Mark read
          </button>
          <button
            v-if="selectedCount > 0"
            class="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
            @click="deleteSelected"
          >
            Delete ({{ selectedCount }})
          </button>
        </div>
      </header>

      <div v-if="mailState.loading" class="flex flex-1 items-center justify-center text-sm text-slate-400">
        <RefreshCw class="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
      <div v-else-if="mailState.messages.length === 0" class="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-400">
        <div>
          <MailIcon class="mx-auto mb-2 h-8 w-8" />
          No messages here yet.
        </div>
      </div>
      <div v-else class="flex-1 overflow-y-auto">
        <button
          v-for="m in mailState.messages"
          :key="m.id"
          class="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
          :class="{ 'bg-blue-50 dark:bg-blue-900/20': mailState.selected?.id === m.id }"
          @click="openMessageById(m)"
        >
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 shrink-0 accent-blue-600"
            :checked="mailState.selectedIds.has(m.id)"
            @click.stop
            @change="toggleSelect(m.id)"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-sm" :class="m.isRead ? 'font-normal text-slate-600 dark:text-slate-300' : 'font-semibold text-slate-900 dark:text-white'">
                {{ m.from?.name || m.from?.address || "(unknown)" }}
              </span>
              <span class="shrink-0 text-xs text-slate-400">{{ formatDate(m.receivedAt) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="truncate text-sm" :class="m.isRead ? 'text-slate-500' : 'font-medium text-slate-700 dark:text-slate-200'">
                {{ m.subject || "(no subject)" }}
              </span>
              <Star v-if="m.isStarred" class="h-3.5 w-3.5 shrink-0 text-yellow-400" />
            </div>
            <div class="truncate text-xs text-slate-400">{{ m.snippet }}</div>
          </div>
        </button>
      </div>
    </section>

    <!-- Detail pane (desktop) -->
    <section class="hidden min-w-0 flex-1 lg:flex">
      <div v-if="!mailState.selected" class="flex flex-1 items-center justify-center text-sm text-slate-400">
        Select a message to read it
      </div>
      <div v-else class="flex flex-1 flex-col overflow-y-auto p-6">
        <h1 class="text-lg font-semibold text-slate-900 dark:text-white">{{ mailState.selected.subject || "(no subject)" }}</h1>
        <div class="mt-2 flex items-center gap-2 text-sm text-slate-500">
          <span class="font-medium">{{ mailState.selected.from?.name || mailState.selected.from?.address }}</span>
          <span class="text-slate-400">&lt;{{ mailState.selected.from?.address }}&gt;</span>
          <span class="ml-auto text-xs">{{ formatDate(mailState.selected.receivedAt) }}</span>
        </div>
        <div class="mt-4 flex gap-2">
          <button
            class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            @click="replyTo"
          >
            <Reply class="h-3.5 w-3.5" /> Reply
          </button>
        </div>
        <div class="email-body mt-6 flex-1" v-html="sanitizeHtml(mailState.selected.html || mailState.selected.text || '')" /><!-- eslint-disable-line vue/no-v-html -- sanitized with DOMPurify above -->
      </div>
    </section>

    <!-- Mobile bottom navigation -->
    <nav class="fixed inset-x-0 bottom-0 z-20 flex items-center justify-around border-t border-slate-200 bg-white py-2 dark:border-slate-800 dark:bg-slate-900 md:hidden">
      <button class="flex flex-col items-center gap-0.5 px-4 py-1 text-xs text-slate-600 dark:text-slate-300" @click="router.push({ name: 'mailbox' })">
        <MailIcon class="h-5 w-5" /> Mail
      </button>
      <button class="flex flex-col items-center gap-0.5 px-4 py-1 text-xs text-blue-600" @click="router.push({ name: 'compose' })">
        <Plus class="h-5 w-5" /> Compose
      </button>
      <button class="flex flex-col items-center gap-0.5 px-4 py-1 text-xs text-slate-600 dark:text-slate-300" @click="router.push({ name: 'settings' })">
        <Settings class="h-5 w-5" /> Settings
      </button>
    </nav>
  </div>
</template>