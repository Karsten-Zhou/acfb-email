<script setup lang="ts">
// Message detail view (primarily for mobile; desktop renders in MailboxView).
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import DOMPurify from "dompurify";
import { openMessage, updateFlags, deleteMessages } from "../stores/mail";
import { Star, Trash2, Reply, ChevronLeft, Paperclip, Archive } from "lucide-vue-next";
import type { MessageDetail } from "@shared/types";

const route = useRoute();
const router = useRouter();
const msg = ref<MessageDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    msg.value = await openMessage(route.params.id as string);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load message";
  } finally {
    loading.value = false;
  }
});

async function toggleRead() {
  if (!msg.value) return;
  await updateFlags([msg.value.id], { read: !msg.value.isRead });
}
async function toggleStar() {
  if (!msg.value) return;
  await updateFlags([msg.value.id], { starred: !msg.value.isStarred });
}
async function remove() {
  if (!msg.value) return;
  await deleteMessages([msg.value.id]);
  router.back();
}

function reply() {
  if (!msg.value) return;
  const m = msg.value;
  router.push({
    name: "compose",
    query: { to: m.from?.address ?? "", subject: m.subject ? (m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`) : "" },
  });
}

function sanitizeHtml(s: string): string {
  return DOMPurify.sanitize(s);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
      <button class="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="router.back()" aria-label="Back">
        <ChevronLeft class="h-5 w-5" />
      </button>
      <div class="flex-1" />
      <button class="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="reply" aria-label="Reply">
        <Reply class="h-5 w-5" />
      </button>
      <button class="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="toggleStar" aria-label="Star">
        <Star class="h-5 w-5" :class="msg?.isStarred ? 'fill-yellow-400 text-yellow-400' : ''" />
      </button>
      <button class="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="toggleRead" aria-label="Mark read/unread">
        <Archive class="h-5 w-5" />
      </button>
      <button class="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" @click="remove" aria-label="Delete">
        <Trash2 class="h-5 w-5" />
      </button>
    </header>

    <main class="flex-1 overflow-y-auto p-4">
      <div v-if="loading" class="py-10 text-center text-sm text-slate-400">Loading…</div>
      <div v-else-if="error" class="py-10 text-center text-sm text-red-500">{{ error }}</div>
      <template v-else-if="msg">
        <h1 class="text-xl font-semibold text-slate-900 dark:text-white">{{ msg.subject || "(no subject)" }}</h1>
        <div class="mt-3 flex items-center gap-2 text-sm">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {{ (msg.from?.name || msg.from?.address || "?").charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0">
            <div class="truncate font-medium text-slate-800 dark:text-slate-100">{{ msg.from?.name || msg.from?.address }}</div>
            <div class="truncate text-xs text-slate-400">{{ msg.from?.address }}</div>
          </div>
          <div class="ml-auto shrink-0 text-xs text-slate-400">{{ formatDate(msg.receivedAt) }}</div>
        </div>

        <div v-if="msg.to.length" class="mt-2 text-xs text-slate-500">
          To: <span v-for="(t, i) in msg.to" :key="i">{{ t.name || t.address }}<span v-if="i < msg.to.length - 1">, </span></span>
        </div>

        <div v-if="msg.attachments?.length" class="mt-3 flex flex-wrap gap-2">
          <div v-for="a in msg.attachments" :key="a.id" class="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
            <Paperclip class="h-3.5 w-3.5 text-slate-400" />
            <span class="max-w-[180px] truncate">{{ a.filename || "attachment" }}</span>
          </div>
        </div>

        <div class="email-body mt-5 text-[15px] text-slate-800 dark:text-slate-100" v-html="sanitizeHtml(msg.html || msg.text || '')" /><!-- eslint-disable-line vue/no-v-html -- sanitized with DOMPurify -->
      </template>
    </main>
  </div>
</template>