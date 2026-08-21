<script setup lang="ts">
// Compose view: send email, save drafts, reply prefill via query params.
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { accountsState, loadAccounts } from "../stores/accounts";
import { api } from "../lib/api";
import Button from "../components/ui/button/AppButton.vue";
import { ChevronLeft, Send, Trash2, FilePlus2 } from "lucide-vue-next";

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
const draftId = ref<string | null>(null);
const error = ref<string | null>(null);

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
    const toList = to.value.split(",").map((s) => s.trim()).filter(Boolean);
    const ccList = cc.value.split(",").map((s) => s.trim()).filter(Boolean);
    const bccList = bcc.value.split(",").map((s) => s.trim()).filter(Boolean);
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
  try {
    const toList = to.value.split(",").map((s) => s.trim()).filter(Boolean);
    const ccList = cc.value.split(",").map((s) => s.trim()).filter(Boolean);
    const bccList = bcc.value.split(",").map((s) => s.trim()).filter(Boolean);
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
      <Button variant="ghost" size="icon" class="h-8 w-8" @click="router.back()" title="Back">
        <ChevronLeft class="h-4 w-4" />
      </Button>
      <h1 class="text-sm font-semibold">New message</h1>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" @click="saveDraft">
        <FilePlus2 class="h-4 w-4" /> Save draft
      </Button>
      <Button variant="default" size="sm" :disabled="!canSend || sending" @click="send">
        <Send class="h-4 w-4" /> {{ sending ? "Sending…" : "Send" }}
      </Button>
      <Button variant="ghost" size="icon" class="h-8 w-8 text-destructive" @click="discard" title="Discard">
        <Trash2 class="h-4 w-4" />
      </Button>
    </header>

    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="error" class="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {{ error }}
      </div>

      <div class="space-y-3">
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-muted-foreground">From</label>
          <select v-model="accountId" class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm">
            <option v-for="a in accountsState.accounts" :key="a.id" :value="a.id">{{ a.name }} &lt;{{ a.email }}&gt;</option>
          </select>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-muted-foreground">To</label>
          <input v-model="to" class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="recipient@example.com, another@example.com" />
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-muted-foreground">CC</label>
          <input v-model="cc" class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="cc@example.com" />
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-muted-foreground">BCC</label>
          <input v-model="bcc" class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="bcc@example.com" />
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-muted-foreground">Subject</label>
          <input v-model="subject" class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="Subject" />
        </div>

        <div class="flex items-center gap-1">
          <button
            class="rounded-md px-2.5 py-1 text-xs font-medium"
            :class="mode === 'text' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'"
            @click="mode = 'text'"
          >
            Plain text
          </button>
          <button
            class="rounded-md px-2.5 py-1 text-xs font-medium"
            :class="mode === 'html' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'"
            @click="mode = 'html'"
          >
            HTML
          </button>
        </div>

        <textarea
          v-model="body"
          class="min-h-[280px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm placeholder:text-muted-foreground"
          :placeholder="mode === 'html' ? '<p>Write HTML here…</p>' : 'Write your message…'"
        />
      </div>
    </div>
  </div>
</template>