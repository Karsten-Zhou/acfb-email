<script setup lang="ts">
// Compose view: send email, save drafts, reply prefill via query params.
// The body is a rich-text (HTML) editor; the From selector and CC/BCC toggles
// sit in the header/to-row to match the rest of the app's density. Form logic
// (fields, send/save-draft/discard, draft loading) lives in useComposeForm and
// attachment file handling in useComposeAttachments.
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useComposeForm } from "../composables/useComposeForm";
import { useComposeAttachments } from "../composables/useComposeAttachments";
import { t } from "../lib/i18n";
import { formatAttachmentSize } from "../lib/utils";
import { cn } from "../lib/cn";
import Button from "../components/UiButton.vue";
import AppTooltip from "../components/UiToolTip.vue";
import RichTextEditor from "../components/RichTextEditor.vue";
import UiSelect from "../components/UiSelect.vue";
import { ChevronLeft, Send, Trash2, FilePlus2, Loader2, Paperclip, X } from "@lucide/vue";

const route = useRoute();
const router = useRouter();

/** The editor, exposing getText() for the text/plain MIME part. */
const editorRef = ref<{ getText: () => string } | null>(null);
const { attachments, addingFiles, fileInput, pickFiles, onFilesChosen, removeAttachment } =
  useComposeAttachments();
const form = useComposeForm({ route, router, editorRef, attachments });

onMounted(() => form.init());

const {
  accountId,
  to,
  cc,
  bcc,
  subject,
  body,
  showCc,
  showBcc,
  sending,
  savingDraft,
  error,
  canSend,
  accountOptions,
  send,
  saveDraft,
  discard,
} = form;
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <header class="border-b border-border bg-card">
      <div class="flex items-center gap-2 px-3 py-1.5">
        <AppTooltip :label="t('common.back')">
          <Button variant="ghost" size="icon" class="h-8 w-8" @click="router.back()">
            <ChevronLeft class="h-4 w-4" />
          </Button>
        </AppTooltip>
        <h1 class="text-sm font-semibold">{{ t("compose.newMessage") }}</h1>
      </div>
      <div class="flex items-center gap-2 px-3 pb-2">
        <Button variant="default" size="sm" :disabled="!canSend || sending" @click="send">
          <Loader2 v-if="sending" class="h-4 w-4 animate-spin" />
          <Send v-else class="h-4 w-4" /> {{ sending ? t("compose.sending") : t("compose.send") }}
        </Button>

        <UiSelect
          v-model="accountId"
          :options="accountOptions"
          :prefix="t('compose.fromLabel')"
          :aria-label="t('compose.from')"
        />

        <div class="flex-1" />

        <Button variant="ghost" size="sm" :disabled="savingDraft" @click="saveDraft">
          <Loader2 v-if="savingDraft" class="h-4 w-4 animate-spin" />
          <FilePlus2 v-else class="h-4 w-4" />
          <span class="hidden sm:inline">{{ t("compose.saveDraft") }}</span>
        </Button>

        <AppTooltip :label="t('compose.discard')">
          <Button variant="ghost-destructive" size="icon" class="h-8 w-8" @click="discard">
            <Trash2 class="h-4 w-4" />
          </Button>
        </AppTooltip>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-4">
      <div
        v-if="error"
        class="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {{ error }}
      </div>

      <div class="space-y-3">
        <div class="flex items-center gap-2 text-sm">
          <label for="compose-to" class="w-14 shrink-0 text-muted-foreground">{{
            t("compose.to")
          }}</label>
          <input
            id="compose-to"
            v-model="to"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground"
            :placeholder="'recipient@example.com'"
          />
          <Button
            variant="ghost"
            size="sm"
            :class="cn(showCc && 'bg-accent text-accent-foreground')"
            @click="showCc = !showCc"
          >
            {{ t("compose.cc") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :class="cn(showBcc && 'bg-accent text-accent-foreground')"
            @click="showBcc = !showBcc"
          >
            {{ t("compose.bcc") }}
          </Button>
        </div>

        <div v-if="showCc" class="flex items-center gap-2 text-sm">
          <label for="compose-cc" class="w-14 shrink-0 text-muted-foreground">{{
            t("compose.cc")
          }}</label>
          <input
            id="compose-cc"
            v-model="cc"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground"
            :placeholder="'cc@example.com'"
          />
        </div>

        <div v-if="showBcc" class="flex items-center gap-2 text-sm">
          <label for="compose-bcc" class="w-14 shrink-0 text-muted-foreground">{{
            t("compose.bcc")
          }}</label>
          <input
            id="compose-bcc"
            v-model="bcc"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground"
            :placeholder="'bcc@example.com'"
          />
        </div>

        <div class="flex items-center gap-2 text-sm">
          <label for="compose-subject" class="w-14 shrink-0 text-muted-foreground">{{
            t("compose.subject")
          }}</label>
          <input
            id="compose-subject"
            v-model="subject"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground"
            :placeholder="t('compose.subject')"
          />
        </div>

        <input ref="fileInput" type="file" multiple class="hidden" @change="onFilesChosen" />

        <RichTextEditor ref="editorRef" v-model="body" :placeholder="t('common.content')">
          <template #toolbar>
            <AppTooltip :label="t('compose.attach')">
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :disabled="addingFiles"
                @click="pickFiles"
              >
                <Loader2 v-if="addingFiles" class="h-4 w-4 animate-spin" />
                <Paperclip v-else class="h-4 w-4" />
              </Button>
            </AppTooltip>
          </template>
        </RichTextEditor>

        <div v-if="attachments.length" class="flex flex-wrap gap-2">
          <div
            v-for="(a, i) in attachments"
            :key="i"
            class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs"
          >
            <Paperclip class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="max-w-55 truncate">{{ a.name }}</span>
            <span v-if="a.size > 0" class="text-muted-foreground">
              ({{ formatAttachmentSize(a.size) }})
            </span>
            <button
              class="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              :aria-label="t('compose.removeAttachment')"
              @click="removeAttachment(i)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
