<script setup lang="ts">
// MessageReaderPane — the rightmost reading column: header actions
// (back/reply/star/read/delete), meta rows, and the sanitized body.
import { mailState } from "../../stores/mail";
import { sanitizeHtml } from "../../lib/sanitize";
import { t, formatDateTime } from "../../lib/i18n";
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
} from "lucide-vue-next";

defineProps<{
  loading: boolean;
}>();

const emit = defineEmits<{
  back: [];
  reply: [];
  "toggle-star": [];
  "toggle-read": [];
  "confirm-delete": [];
}>();

// `sanitizeHtml` is the imported helper from lib/sanitize; it's used directly
// in the template's v-html binding (safe: our DOMPurify config preserves email
// centering attributes like td[align=center]).
</script>

<template>
  <section
    class="min-w-0 flex-1 flex-col bg-background"
    :class="mailState.selected || loading ? 'flex md:flex' : 'hidden md:flex'"
  >
    <!-- Loading takes priority: on the first click the route triggers and
         `selected` isn't set yet, so the spinner must show immediately
         instead of the "select a message" placeholder. -->
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      <RefreshCw class="mr-2 h-4 w-4 animate-spin" /> {{ t("content") }}…
    </div>
    <div
      v-else-if="!mailState.selected"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      {{ t("selectToRead") }}
    </div>
    <template v-else>
      <header class="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <AppTooltip :label="t('content')" side="bottom">
          <Button variant="ghost" size="icon" class="h-8 w-8 md:hidden" @click="emit('back')">
            <ChevronLeft class="h-4 w-4" />
          </Button>
        </AppTooltip>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-base font-semibold leading-tight">
            {{ mailState.selected.subject || "(no subject)" }}
          </h1>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span class="font-medium text-foreground">{{
              mailState.selected.from?.name || mailState.selected.from?.address
            }}</span>
            <span v-if="mailState.selected.from?.address" class="text-xs"
              >&lt;{{ mailState.selected.from.address }}&gt;</span
            >
            <span class="text-xs">{{ formatDateTime(mailState.selected.receivedAt) }}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <AppTooltip :label="t('reply')">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('reply')">
              <Reply class="h-4 w-4" />
            </Button>
          </AppTooltip>
          <AppTooltip :label="t('star')">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('toggle-star')">
              <Star
                class="h-4 w-4"
                :class="mailState.selected.isStarred ? 'fill-yellow-400 text-yellow-400' : ''"
              />
            </Button>
          </AppTooltip>
          <AppTooltip :label="mailState.selected.isRead ? t('markUnread') : t('markRead')">
            <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('toggle-read')">
              <MailIcon class="h-4 w-4" />
            </Button>
          </AppTooltip>
          <AppTooltip :label="t('delete')">
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
      </header>

      <div
        v-if="mailState.selected.to.length"
        class="border-b border-border px-5 py-1.5 text-xs text-muted-foreground"
      >
        To:
        <span v-for="(recip, i) in mailState.selected.to" :key="i"
          >{{ recip.name || recip.address
          }}<span v-if="i < mailState.selected.to.length - 1">, </span></span
        >
      </div>
      <div
        v-if="mailState.selected.attachments?.length"
        class="flex flex-wrap gap-2 border-b border-border px-5 py-2"
      >
        <div
          v-for="a in mailState.selected.attachments"
          :key="a.id"
          class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs"
        >
          <Paperclip class="h-3.5 w-3.5 text-muted-foreground" />
          <span class="max-w-[200px] truncate">{{ a.filename || "attachment" }}</span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-5">
        <div
          class="email-body text-[15px]"
          v-html="sanitizeHtml(mailState.selected.html || mailState.selected.text || '')"
        />
        <!-- eslint-disable-line vue/no-v-html -- sanitized with DOMPurify -->
      </div>
    </template>
  </section>
</template>
