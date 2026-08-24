<script setup lang="ts">
// Compose view: send email, save drafts, reply prefill via query params.
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { accountsState, loadAccounts } from "../stores/accounts";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { formatAttachmentSize } from "../lib/utils";
import Button from "../components/UiButton.vue";
import AppTooltip from "../components/UiToolTip.vue";
import { ChevronLeft, Send, Trash2, FilePlus2, Loader2, Paperclip, X } from "lucide-vue-next";

const route = useRoute();
const router = useRouter();

const accountId = ref("");
const to = ref("");
const cc = ref("");
const bcc = ref("");
const subject = ref("");
const body = ref("");
const mode = ref<"html" | "text">("text");
const sending = ref(false);
const savingDraft = ref(false);
const draftId = ref<string | null>(null);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
/** Files to attach to the outgoing message (read client-side). */
const attachments = ref<{ name: string; mimeType: string; size: number; base64: string }[]>([]);
const addingFiles = ref(false);

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
  await loadAccounts();
  if (accountsState.accounts.length > 0) {
    accountId.value = accountsState.accounts[0].id;
  }
  // Prefill from query (reply).
  if (route.query.to) to.value = route.query.to as string;
  if (route.query.subject) subject.value = route.query.subject as string;

  // Load a draft if navigated via compose/:draftId
  const draftParam = route.params.draftId as string | undefined;
  if (draftParam) {
    draftId.value = draftParam;
    const { drafts } = await api.drafts();
    const d = drafts.find((x) => x.id === draftParam);
    if (d) {
      if (d.accountId) accountId.value = d.accountId;
      to.value = d.to.join(", ");
      cc.value = d.cc.join(", ");
      bcc.value = d.bcc.join(", ");
      subject.value = d.subject ?? "";
      body.value = d.text ?? d.html ?? "";
    }
  }
});

const canSend = computed(() => to.value.trim().length > 0 && accountId.value.length > 0);

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  error.value = null;
  try {
    const toList = to.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ccList = cc.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bccList = bcc.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await api.send({
      accountId: accountId.value,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: subject.value,
      html: mode.value === "html" ? body.value : "",
      text: mode.value === "text" ? body.value : "",
      inReplyTo: null,
      references: [],
      attachments: [],
      newAttachments: attachments.value,
    });
    if (draftId.value) await api.deleteDraft(draftId.value);
    router.push({ name: "mailbox" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to send";
  } finally {
    sending.value = false;
  }
}

async function saveDraft() {
  savingDraft.value = true;
  try {
    const toList = to.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ccList = cc.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bccList = bcc.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await api.saveDraft({
      id: draftId.value ?? undefined,
      accountId: accountId.value || null,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: subject.value,
      html: mode.value === "html" ? body.value : "",
      text: mode.value === "text" ? body.value : "",
    });
    draftId.value = res.id;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to save draft";
  } finally {
    savingDraft.value = false;
  }
}

function discard() {
  if (draftId.value) void api.deleteDraft(draftId.value);
  router.push({ name: "mailbox" });
}
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <header class="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
      <AppTooltip :label="t('back')">
        <Button variant="ghost" size="icon" class="h-8 w-8" @click="router.back()">
          <ChevronLeft class="h-4 w-4" />
        </Button>
      </AppTooltip>
      <h1 class="text-sm font-semibold">{{ t("newMessage") }}</h1>
      <div class="flex-1" />
      <AppTooltip :label="t('saveDraft')">
        <Button variant="ghost" size="sm" :disabled="savingDraft" @click="saveDraft">
          <Loader2 v-if="savingDraft" class="h-4 w-4 animate-spin" />
          <FilePlus2 v-else class="h-4 w-4" /> {{ t("saveDraft") }}
        </Button>
      </AppTooltip>
      <AppTooltip :label="sending ? t('sending') : t('send')">
        <Button variant="default" size="sm" :disabled="!canSend || sending" @click="send">
          <Loader2 v-if="sending" class="h-4 w-4 animate-spin" />
          <Send v-else class="h-4 w-4" /> {{ sending ? t("sending") : t("send") }}
        </Button>
      </AppTooltip>
      <AppTooltip :label="t('discard')">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 text-destructive hover:bg-destructive hover:text-white"
          @click="discard"
        >
          <Trash2 class="h-4 w-4" />
        </Button>
      </AppTooltip>
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
          <label for="compose-from" class="w-14 shrink-0 text-muted-foreground">{{
            t("from")
          }}</label>
          <select
            id="compose-from"
            v-model="accountId"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
          >
            <option v-for="a in accountsState.accounts" :key="a.id" :value="a.id">
              {{ a.name }} &lt;{{ a.email }}&gt;
            </option>
          </select>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label for="compose-to" class="w-14 shrink-0 text-muted-foreground">{{ t("to") }}</label>
          <input
            id="compose-to"
            v-model="to"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground"
            :placeholder="'recipient@example.com'"
          />
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label for="compose-cc" class="w-14 shrink-0 text-muted-foreground">{{ t("cc") }}</label>
          <input
            id="compose-cc"
            v-model="cc"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground"
            :placeholder="'cc@example.com'"
          />
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label for="compose-bcc" class="w-14 shrink-0 text-muted-foreground">{{
            t("bcc")
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
            t("subject")
          }}</label>
          <input
            id="compose-subject"
            v-model="subject"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground"
            :placeholder="t('subject')"
          />
        </div>

        <div class="flex items-center gap-1">
          <button
            class="rounded-md px-2.5 py-1 text-xs font-medium"
            :class="
              mode === 'text'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            "
            @click="mode = 'text'"
          >
            {{ t("plainText") }}
          </button>
          <button
            class="rounded-md px-2.5 py-1 text-xs font-medium"
            :class="
              mode === 'html'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            "
            @click="mode = 'html'"
          >
            {{ t("html") }}
          </button>
        </div>

        <textarea
          v-model="body"
          class="min-h-[280px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm placeholder:text-muted-foreground"
          :placeholder="mode === 'html' ? '<p>…</p>' : t('content')"
        />

        <!-- Attachments -->
        <div class="flex items-center gap-2">
          <input
            ref="fileInput"
            type="file"
            multiple
            class="hidden"
            @change="onFilesChosen"
          />
          <Button variant="outline" size="sm" :disabled="addingFiles" @click="pickFiles">
            <Loader2 v-if="addingFiles" class="h-4 w-4 animate-spin" />
            <Paperclip v-else class="h-4 w-4" /> {{ t("attach") }}
          </Button>
        </div>
        <div v-if="attachments.length" class="flex flex-wrap gap-2">
          <div
            v-for="(a, i) in attachments"
            :key="i"
            class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs"
          >
            <Paperclip class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="max-w-[220px] truncate">{{ a.name }}</span>
            <span v-if="a.size > 0" class="text-muted-foreground">
              ({{ formatAttachmentSize(a.size) }})
            </span>
            <button
              class="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              :aria-label="t('removeAttachment')"
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
