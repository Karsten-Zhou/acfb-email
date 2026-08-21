<script setup lang="ts">
// Message detail view (primarily for mobile; desktop renders in MailboxView).
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import DOMPurify from "dompurify";
import { openMessage, updateFlags, deleteMessages } from "../stores/mail";
import { t } from "../lib/i18n";
import { Star, Trash2, Reply, ChevronLeft, Paperclip, MailOpen } from "lucide-vue-next";
import type { MessageDetail } from "@shared/types";

const route = useRoute();
const router = useRouter();
const msg = ref<MessageDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const confirmDelete = ref(false);
const deleting = ref(false);

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

function askDelete() {
  confirmDelete.value = true;
}

async function remove() {
  if (!msg.value) return;
  deleting.value = true;
  try {
    await deleteMessages([msg.value.id]);
    router.back();
  } finally {
    deleting.value = false;
  }
}

function reply() {
  if (!msg.value) return;
  const m = msg.value;
  router.push({
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
  <div class="flex h-full flex-col bg-background">
    <header class="flex items-center gap-1 border-b border-border bg-card px-2 py-2">
      <button class="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground" :aria-label="t('content')" @click="router.back()">
        <ChevronLeft class="h-5 w-5" />
      </button>
      <div class="flex-1" />
      <button class="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground" :aria-label="t('reply')" @click="reply">
        <Reply class="h-5 w-5" />
      </button>
      <button class="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground" :aria-label="t('star')" @click="toggleStar">
        <Star class="h-5 w-5" :class="msg?.isStarred ? 'fill-yellow-400 text-yellow-400' : ''" />
      </button>
      <button class="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground" :aria-label="t('markRead')" @click="toggleRead">
        <MailOpen class="h-5 w-5" />
      </button>
      <button class="rounded-md p-2 text-muted-foreground hover:bg-destructive hover:text-white" :aria-label="t('delete')" @click="askDelete">
        <Trash2 class="h-5 w-5" />
      </button>
    </header>

    <!-- delete confirm -->
    <div v-if="confirmDelete" class="border-b border-border bg-card px-4 py-3">
      <p class="text-sm">{{ t('confirmDeleteMessages') }}</p>
      <div class="mt-2 flex gap-2">
        <button
          class="inline-flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground disabled:opacity-50"
          :disabled="deleting"
          @click="remove"
        >
          {{ deleting ? '…' : t('ok') }}
        </button>
        <button class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent" @click="confirmDelete = false">{{ t('cancelAction') }}</button>
      </div>
    </div>

    <main class="flex-1 overflow-y-auto p-4">
      <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">{{ t('content') }}…</div>
      <div v-else-if="error" class="py-10 text-center text-sm text-destructive">{{ error }}</div>
      <template v-else-if="msg">
        <h1 class="text-xl font-semibold">{{ msg.subject || '(no subject)' }}</h1>
        <div class="mt-3 flex items-center gap-2 text-sm">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {{ (msg.from?.name || msg.from?.address || '?').charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0">
            <div class="truncate font-medium">{{ msg.from?.name || msg.from?.address }}</div>
            <div class="truncate text-xs text-muted-foreground">{{ msg.from?.address }}</div>
          </div>
          <div class="ml-auto shrink-0 text-xs text-muted-foreground">{{ formatDate(msg.receivedAt) }}</div>
        </div>

        <div v-if="msg.to.length" class="mt-2 text-xs text-muted-foreground">
          To: <span v-for="(t, i) in msg.to" :key="i">{{ t.name || t.address }}<span v-if="i < msg.to.length - 1">, </span></span>
        </div>

        <div v-if="msg.attachments?.length" class="mt-3 flex flex-wrap gap-2">
          <div v-for="a in msg.attachments" :key="a.id" class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
            <Paperclip class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="max-w-[180px] truncate">{{ a.filename || 'attachment' }}</span>
          </div>
        </div>

        <div class="email-body mt-5 text-[15px]" v-html="sanitizeHtml(msg.html || msg.text || '')" /><!-- eslint-disable-line vue/no-v-html -- sanitized with DOMPurify -->
      </template>
    </main>
  </div>
</template>