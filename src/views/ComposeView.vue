<script setup lang="ts">
// Compose view: send email, save drafts, reply prefill via query params.
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { accountsState, loadAccounts } from "../stores/accounts";
import { api } from "../lib/api";
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
  <div class="flex h-full flex-col">
    <header class="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
      <button class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="router.back()" aria-label="Back">
        <ChevronLeft class="h-5 w-5" />
      </button>
      <h1 class="text-sm font-semibold text-slate-800 dark:text-slate-100">New message</h1>
      <div class="flex-1" />
      <button class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" @click="saveDraft">
        <FilePlus2 class="h-4 w-4" /> Save draft
      </button>
      <button class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50" :disabled="!canSend || sending" @click="send">
        <Send class="h-3.5 w-3.5" /> {{ sending ? "Sending…" : "Send" }}
      </button>
      <button class="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" @click="discard" aria-label="Discard">
        <Trash2 class="h-4 w-4" />
      </button>
    </header>

    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="error" class="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">
        {{ error }}
      </div>

      <div class="space-y-3">
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-slate-500">From</label>
          <select v-model="accountId" class="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
            <option v-for="a in accountsState.accounts" :key="a.id" :value="a.id">{{ a.name }} &lt;{{ a.email }}&gt;</option>
          </select>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-slate-500">To</label>
          <input v-model="to" class="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="recipient@example.com, another@example.com" />
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-slate-500">CC</label>
          <input v-model="cc" class="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="cc@example.com" />
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-slate-500">BCC</label>
          <input v-model="bcc" class="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="bcc@example.com" />
        </div>
        <div class="flex items-center gap-2 text-sm">
          <label class="w-14 shrink-0 text-slate-500">Subject</label>
          <input v-model="subject" class="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Subject" />
        </div>

        <div class="flex items-center gap-1">
          <button
            class="rounded-md px-2.5 py-1 text-xs font-medium"
            :class="mode === 'text' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'"
            @click="mode = 'text'"
          >
            Plain text
          </button>
          <button
            class="rounded-md px-2.5 py-1 text-xs font-medium"
            :class="mode === 'html' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'"
            @click="mode = 'html'"
          >
            HTML
          </button>
        </div>

        <textarea
          v-model="body"
          class="min-h-[280px] w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
          :placeholder="mode === 'html' ? '<p>Write HTML here…</p>' : 'Write your message…'"
        />
      </div>
    </div>
  </div>
</template>