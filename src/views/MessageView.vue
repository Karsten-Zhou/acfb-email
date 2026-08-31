<script setup lang="ts">
// Message detail view (primarily for mobile; desktop renders in MailboxView).
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMessage, useUpdateFlags, useDeleteMessages } from "../stores/mail";
import { useRemoteImageControl } from "../composables/useRemoteImageControl";
import RemoteImagesBanner from "./parts/RemoteImagesBanner.vue";
import { t, formatDateTime } from "../lib/i18n";
import UiButton from "../components/UiButton.vue";
import UiToolTip from "../components/UiToolTip.vue";
import UiDialog from "../components/UiDialog.vue";
import { Star, Trash2, Reply, ChevronLeft, Paperclip, MailOpen, Loader2 } from "@lucide/vue";

const route = useRoute();
const router = useRouter();
const messageQuery = useMessage(
  computed(() => (typeof route.params.id === "string" ? route.params.id : undefined)),
);
const msg = computed(() => messageQuery.data.value ?? null);
const loading = computed(() => messageQuery.isLoading.value);
const error = computed(() =>
  messageQuery.isError.value
    ? (messageQuery.error.value?.message ?? "Failed to load message")
    : null,
);
const confirmDelete = ref(false);

const { mutate: updateFlags } = useUpdateFlags();
const { mutateAsync: deleteMessages, isPending: deleting } = useDeleteMessages();

// Auto-mark read on open (once per message id).
const autoReadHandledId = ref<string | null>(null);
watch(messageQuery.data, (m) => {
  if (!m || autoReadHandledId.value === m.id || m.isRead) return;
  autoReadHandledId.value = m.id;
  updateFlags({ ids: [m.id], flags: { read: true } });
});

function toggleRead() {
  if (!msg.value) return;
  updateFlags({ ids: [msg.value.id], flags: { read: !msg.value.isRead } });
}
function toggleStar() {
  if (!msg.value) return;
  updateFlags({ ids: [msg.value.id], flags: { starred: !msg.value.isStarred } });
}

function askDelete() {
  confirmDelete.value = true;
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
    query: {
      to: m.from?.address ?? "",
      subject: m.subject ? (m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`) : "",
    },
  });
}

// ---- remote-image privacy ----
const { sanitized, showBanner, loadImagesThisTime, allowFromSender, alwaysAllowImages } =
  useRemoteImageControl(() => msg.value);
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <header class="flex items-center gap-1 border-b border-border bg-card px-2 py-2">
      <UiToolTip :label="t('common.back')">
        <UiButton variant="ghost" size="icon" class="h-8 w-8" @click="router.back()">
          <ChevronLeft class="h-5 w-5" />
        </UiButton>
      </UiToolTip>
      <div class="flex-1" />
      <UiToolTip :label="t('message.reply')">
        <UiButton variant="ghost" size="icon" class="h-8 w-8" @click="reply">
          <Reply class="h-5 w-5" />
        </UiButton>
      </UiToolTip>
      <UiToolTip :label="t('message.star')">
        <UiButton variant="ghost" size="icon" class="h-8 w-8" @click="toggleStar">
          <Star class="h-5 w-5" :class="msg?.isStarred ? 'fill-yellow-400 text-yellow-400' : ''" />
        </UiButton>
      </UiToolTip>
      <UiToolTip :label="msg?.isRead ? t('message.markUnread') : t('message.markRead')">
        <UiButton variant="ghost" size="icon" class="h-8 w-8" @click="toggleRead">
          <MailOpen class="h-5 w-5" />
        </UiButton>
      </UiToolTip>
      <UiToolTip :label="t('common.delete')">
        <UiButton
          variant="ghost"
          size="icon"
          class="h-8 w-8 text-destructive hover:bg-destructive hover:text-white"
          @click="askDelete"
        >
          <Trash2 class="h-5 w-5" />
        </UiButton>
      </UiToolTip>
    </header>

    <main class="flex-1 overflow-y-auto p-4">
      <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
        {{ t("common.content") }}…
      </div>
      <div v-else-if="error" class="py-10 text-center text-sm text-destructive">{{ error }}</div>
      <template v-else-if="msg">
        <h1 class="text-xl font-semibold">{{ msg.subject || "(no subject)" }}</h1>
        <div class="mt-3 flex items-center gap-2 text-sm">
          <div
            class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
          >
            {{ (msg.from?.name || msg.from?.address || "?").charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0">
            <div class="truncate font-medium">{{ msg.from?.name || msg.from?.address }}</div>
            <div class="truncate text-xs text-muted-foreground">{{ msg.from?.address }}</div>
          </div>
          <div class="ml-auto shrink-0 text-xs text-muted-foreground">
            {{ formatDateTime(msg.receivedAt) }}
          </div>
        </div>

        <div v-if="msg.to.length" class="mt-2 text-xs text-muted-foreground">
          To:
          <span v-for="(recip, i) in msg.to" :key="i"
            >{{ recip.name || recip.address }}<span v-if="i < msg.to.length - 1">, </span></span
          >
        </div>

        <div v-if="msg.attachments?.length" class="mt-3 flex flex-wrap gap-2">
          <div
            v-for="a in msg.attachments"
            :key="a.id"
            class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs"
          >
            <Paperclip class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="max-w-45 truncate">{{ a.filename || "attachment" }}</span>
          </div>
        </div>

        <RemoteImagesBanner
          v-if="showBanner"
          @load-this-time="loadImagesThisTime"
          @allow-from-sender="allowFromSender"
          @always-allow="alwaysAllowImages"
        />

        <div class="email-body mt-5 text-[15px]" v-html="sanitized?.html ?? ''" />
      </template>
    </main>

    <!-- Modal delete confirmation -->
    <UiDialog
      :open="confirmDelete"
      :title="t('message.confirmDeleteMessages')"
      :busy="deleting"
      @close="confirmDelete = false"
    >
      <p class="text-sm text-muted-foreground">{{ t("message.confirmDeleteMessages") }}</p>
      <template #footer>
        <UiButton variant="ghost" size="sm" :disabled="deleting" @click="confirmDelete = false">{{
          t("common.cancelAction")
        }}</UiButton>
        <UiButton variant="destructive" size="sm" :disabled="deleting" @click="remove">
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" /> {{ t("common.ok") }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
