<script setup lang="ts">
// Settings view: connected accounts, add account (IMAP), logout.
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { accountsState, loadAccounts, removeAccount, syncAccount } from "../stores/accounts";
import { logout } from "../stores/auth";
import { api } from "../lib/api";
import { ChevronLeft, Plus, RefreshCw, Trash2, Loader2, CheckCircle2, XCircle } from "lucide-vue-next";

const router = useRouter();

const showAdd = ref(false);
const adding = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
const error = ref<string | null>(null);

const form = ref({
  name: "",
  email: "",
  displayName: "",
  imapHost: "imap.gmail.com",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  smtpSecure: true,
  username: "",
  password: "",
});

onMounted(async () => {
  await loadAccounts();
});

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    const res = await api.testAccount({
      provider: "imap",
      ...form.value,
    });
    testResult.value = { ok: res.ok, message: res.message ?? "OK" };
  } catch (err) {
    testResult.value = { ok: false, message: err instanceof Error ? err.message : "Failed" };
  } finally {
    testing.value = false;
  }
}

async function addAccount() {
  adding.value = true;
  error.value = null;
  try {
    await api.addAccount({ provider: "imap", ...form.value });
    showAdd.value = false;
    form.value.password = "";
    await loadAccounts();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to add account";
  } finally {
    adding.value = false;
  }
}

async function remove(id: string) {
  if (!window.confirm("Remove this account? This deletes synced mail for it.")) return;
  await removeAccount(id);
}

async function syncOne(id: string) {
  await syncAccount(id);
  await loadAccounts();
}

async function doLogout() {
  await logout();
  router.push({ name: "login" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
      <button class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="router.push({ name: 'mailbox' })" aria-label="Back">
        <ChevronLeft class="h-5 w-5" />
      </button>
      <h1 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Settings</h1>
      <div class="flex-1" />
      <button class="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30" @click="doLogout">
        Sign out
      </button>
    </header>

    <main class="flex-1 overflow-y-auto p-4 md:p-6">
      <!-- Connected accounts -->
      <section class="mx-auto max-w-2xl">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">Email accounts</h2>
          <button class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500" @click="showAdd = !showAdd">
            <Plus class="h-3.5 w-3.5" /> Add account
          </button>
        </div>

        <!-- Add form -->
        <div v-if="showAdd" class="mb-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <h3 class="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">Connect IMAP / SMTP account</h3>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input v-model="form.name" class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Label (e.g. Work)" />
            <input v-model="form.email" type="email" class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="your@email.com" />
            <input v-model="form.displayName" class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Display name (optional)" />
            <input v-model="form.username" class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Username / login" />
            <input v-model="form.password" type="password" class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Password / app password" />
            <input v-model="form.imapHost" class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="IMAP host (imap.example.com)" />
            <div class="flex gap-2">
              <input v-model.number="form.imapPort" type="number" class="w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
              <label class="flex items-center gap-1.5 text-xs text-slate-500">
                <input v-model="form.imapSecure" type="checkbox" class="accent-blue-600" /> TLS
              </label>
            </div>
            <input v-model="form.smtpHost" class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="SMTP host (smtp.example.com)" />
            <div class="flex gap-2">
              <input v-model.number="form.smtpPort" type="number" class="w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
              <label class="flex items-center gap-1.5 text-xs text-slate-500">
                <input v-model="form.smtpSecure" type="checkbox" class="accent-blue-600" /> TLS
              </label>
            </div>
          </div>

          <div v-if="testResult" class="mt-3 flex items-center gap-1.5 text-xs" :class="testResult.ok ? 'text-green-600' : 'text-red-600'">
            <CheckCircle2 v-if="testResult.ok" class="h-4 w-4" />
            <XCircle v-else class="h-4 w-4" />
            {{ testResult.message }}
          </div>
          <div v-if="error" class="mt-3 text-xs text-red-600">{{ error }}</div>

          <div class="mt-4 flex gap-2">
            <button class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" :disabled="testing" @click="testConnection">
              <Loader2 v-if="testing" class="h-3.5 w-3.5 animate-spin" />
              Test connection
            </button>
            <button class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50" :disabled="adding" @click="addAccount">
              <Loader2 v-if="adding" class="h-3.5 w-3.5 animate-spin" />
              Add
            </button>
            <button class="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="showAdd = false">
              Cancel
            </button>
          </div>
        </div>

        <!-- Account list -->
        <div v-if="accountsState.accounts.length === 0 && !showAdd" class="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-slate-700">
          No accounts connected yet. Add your first email account to get started.
        </div>
        <div v-for="a in accountsState.accounts" :key="a.id" class="mb-2 flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {{ a.name.charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{{ a.name }} <span class="text-slate-400">&lt;{{ a.email }}&gt;</span></div>
            <div class="text-xs text-slate-400">
              <span v-if="a.state === 'healthy'" class="text-green-600">Healthy</span>
              <span v-else-if="a.state === 'unavailable'" class="text-amber-600">{{ a.stateMessage || "Unavailable" }}</span>
              <span v-else-if="a.state === 'auth_required'" class="text-red-600">Authentication required</span>
              <span v-else>{{ a.state }}</span>
              <span v-if="a.lastSyncedAt" class="ml-2">Synced {{ formatDate(a.lastSyncedAt) }}</span>
            </div>
          </div>
          <button class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" @click="syncOne(a.id)" aria-label="Sync" title="Sync now">
            <RefreshCw class="h-4 w-4" />
          </button>
          <button class="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" @click="remove(a.id)" aria-label="Remove account">
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
      </section>
    </main>
  </div>
</template>