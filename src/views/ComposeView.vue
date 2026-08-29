<script setup lang="ts">
// Compose view: send email, save drafts, reply prefill via query params.
// The body is a rich-text (HTML) editor; the From selector and CC/BCC toggles
// sit in the header/to-row to match the rest of the app's density.
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAccounts, useSyncAccounts } from "../stores/accounts";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { toastSuccess } from "../stores/toast";
import { formatAttachmentSize } from "../lib/utils";
import { cn } from "../lib/cn";
import Button from "../components/UiButton.vue";
import AppTooltip from "../components/UiToolTip.vue";
import RichTextEditor from "../components/RichTextEditor.vue";
import UiSelect from "../components/UiSelect.vue";
import { ChevronLeft, Send, Trash2, FilePlus2, Loader2, Paperclip, X } from "@lucide/vue";

const route = useRoute();
const router = useRouter();

const accountId = ref("");
const to = ref("");
const cc = ref("");
const bcc = ref("");
const subject = ref("");
/** Body is the rich editor's HTML; the text/plain part is derived on send. */
const body = ref("");
/** Whether the CC / BCC lines are expanded (toggled from the To row). */
const showCc = ref(false);
const showBcc = ref(false);
const sending = ref(false);
const savingDraft = ref(false);
const draftId = ref<string | null>(null);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
/** Files to attach to the outgoing message (read client-side). */
const attachments = ref<{ name: string; mimeType: string; size: number; base64: string }[]>([]);
const addingFiles = ref(false);
/** The editor, exposing getText() for the text/plain MIME part. */
const editorRef = ref<{ getText: () => string } | null>(null);

// ---- server state ----
const { data: accounts } = useAccounts();
const { mutate: syncAccounts } = useSyncAccounts();

function pickFiles() {
  fileInput.value?.click();
}

function onFilesChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  addingFiles.value = true;
  void (async () => {
    for (const f of files) {
      const base64 = await fileToBase64(f);
      attachments.value.push({
        name: f.name,
        mimeType: f.type || "application/octet-stream",
        size: f.size,
        base64,
      });
    }
  })().finally(() => {
    addingFiles.value = false;
    if (fileInput.value) fileInput.value.value = "";
  });
}

function removeAttachment(i: number) {
  attachments.value.splice(i, 1);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is a data: URL — strip the prefix.
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

onMounted(async () => {
  // Default the From account once the account list loads (query fetches on
  // mount; this watcher fires when it resolves).
  watch(accounts, (list) => {
    if (accountId.value === "" && list && list.length > 0) {
      accountId.value = list[0].id;
    }
  });
  // Prefill from query (reply).
  if (route.query.to) to.value = route.query.to as string;
  if (route.query.subject) subject.value = route.query.subject as string;

  // Load a draft from the provider's Drafts folder (compose/:draftId where
  // draftId is the message id). api.message() reads the body without marking
  // the message read.
  const draftParam = route.params.draftId as string | undefined;
  if (draftParam) {
    draftId.value = draftParam;
    try {
      const { message } = await api.message(draftParam);
      if (message.accountId) accountId.value = message.accountId;
      to.value = message.to.map((a) => a.address).join(", ");
      cc.value = message.cc.map((a) => a.address).join(", ");
      bcc.value = message.bcc.map((a) => a.address).join(", ");
      showCc.value = message.cc.length > 0;
      showBcc.value = message.bcc.length > 0;
      subject.value = message.subject ?? "";
      body.value = message.html ?? message.text ?? "";
    } catch (err) {
      // The draft is gone upstream — the api layer already toasted the reason
      // and the backend pruned the stale row, so leave compose. Any other
      // error leaves us here with the (empty) form and its own toast.
      if (err instanceof ApiError && err.code === "message_gone") {
        await router.replace({ name: "mailbox" });
      }
    }
  }
});

const canSend = computed(() => to.value.trim().length > 0 && accountId.value.length > 0);

/** Accounts as { value, label } options for the From dropdown. */
const accountOptions = computed(() =>
  (accounts.value ?? []).map((a) => ({ value: a.id, label: `${a.name} <${a.email}>` })),
);

/** Split a comma-separated recipient string into trimmed, non-empty entries. */
function recipients(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The account's Sent mailbox id (if it has one), to land on after sending. */
async function findSentMailbox(accountId: string): Promise<string | null> {
  try {
    const { mailboxes } = await api.mailboxes(accountId);
    return mailboxes.find((m) => m.role === "sent")?.id ?? null;
  } catch {
    return null;
  }
}

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  error.value = null;
  try {
    await api.send({
      accountId: accountId.value,
      to: recipients(to.value),
      cc: recipients(cc.value),
      bcc: recipients(bcc.value),
      subject: subject.value,
      html: body.value,
      text: editorRef.value?.getText() ?? "",
      inReplyTo: null,
      references: [],
      newAttachments: attachments.value,
    });
    if (draftId.value) await api.delete([draftId.value]);
    toastSuccess(t("compose.sendSuccess"));
    // Auto-sync the account so the just-sent mail is pulled into its Sent
    // folder. The sync runs server-side and is not awaited — the account
    // state poller shows progress — so we land on the Sent folder to see it.
    // Sync the account so the just-sent mail lands in its Sent folder; the
    // sync mutation marks it running + refreshes lists on settle.
    syncAccounts([accountId.value]);
    const sentId = await findSentMailbox(accountId.value);
    await router.push({ name: "mailbox", query: sentId ? { mailbox: sentId } : {} });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to send";
  } finally {
    sending.value = false;
  }
}

async function saveDraft() {
  savingDraft.value = true;
  error.value = null;
  try {
    await api.saveDraft({
      accountId: accountId.value,
      to: recipients(to.value),
      cc: recipients(cc.value),
      bcc: recipients(bcc.value),
      subject: subject.value,
      html: body.value,
      text: editorRef.value?.getText() ?? "",
    });
    toastSuccess(t("compose.draftSaved"));
    // The draft now lives in the provider's Drafts folder; sync the account so
    // it appears there (the sync mutation marks it running + refreshes).
    syncAccounts([accountId.value]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to save draft";
  } finally {
    savingDraft.value = false;
  }
}

function discard() {
  // Remove the provider draft if we opened an existing one.
  if (draftId.value) void api.delete([draftId.value]);
  router.push({ name: "mailbox" });
}
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
