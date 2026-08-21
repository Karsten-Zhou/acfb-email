<script setup lang="ts">
// Settings view: connected accounts, add account (IMAP), logout.
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { accountsState, loadAccounts, removeAccount, syncAccount } from "../stores/accounts";
import { logout } from "../stores/auth";
import { api } from "../lib/api";
import Button from "../components/ui/button/Button.vue";
import { ChevronLeft, Plus, RefreshCw, Trash2, Loader2, CheckCircle2, XCircle } from "lucide-vue-next";

const router = useRouter();

const showAdd = ref(false);
const adding = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

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
  // If we just returned from an OAuth provider callback, show a toast-ish note.
  const connected = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("connected");
  if (connected === "google" || connected === "microsoft") {
    notice.value = connected === "google" ? "Gmail connected" : "Outlook connected";
    window.setTimeout(() => (notice.value = null), 4000);
  }
});

async function connectOAuth(provider: "google" | "microsoft") {
  window.location.href = `/api/oauth/${provider}/start`;
}

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
  <div class="flex h-full flex-col bg-background">
    <header class="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
      <Button variant="ghost" size="icon" class="h-8 w-8" @click="router.push({ name: 'mailbox' })" title="Back">
        <ChevronLeft class="h-4 w-4" />
      </Button>
      <h1 class="text-sm font-semibold">Settings</h1>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" class="text-destructive" @click="doLogout">Sign out</Button>
    </header>

    <main class="flex-1 overflow-y-auto p-4 md:p-6">
      <section class="mx-auto max-w-2xl">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold">Email accounts</h2>
          <Button variant="default" size="sm" @click="showAdd = !showAdd">
            <Plus class="h-4 w-4" /> Add account
          </Button>
        </div>

        <div v-if="notice" class="card-surface mb-3 border-emerald-500/40 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
          {{ notice }}
        </div>

        <!-- OAuth providers -->
        <div class="card-surface mb-4 grid gap-2 p-4 sm:grid-cols-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium">Gmail</div>
              <div class="text-xs text-muted-foreground">Connect via Google OAuth</div>
            </div>
            <Button variant="outline" size="sm" @click="connectOAuth('google')">Connect</Button>
          </div>
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium">Outlook / Microsoft</div>
              <div class="text-xs text-muted-foreground">Connect via Microsoft Graph</div>
            </div>
            <Button variant="outline" size="sm" @click="connectOAuth('microsoft')">Connect</Button>
          </div>
        </div>

        <div v-if="showAdd" class="text-sm text-muted-foreground">…or an IMAP / SMTP account:</div>
        <div v-else class="mb-2 text-sm text-muted-foreground">IMAP / SMTP account:</div>

        <!-- Add form -->
        <div v-if="showAdd" class="card-surface mb-4 space-y-3 p-4">
          <h3 class="text-sm font-medium">Connect IMAP / SMTP account</h3>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input v-model="form.name" class="h-9 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="Label (e.g. Work)" />
            <input v-model="form.email" type="email" class="h-9 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="your@email.com" />
            <input v-model="form.displayName" class="h-9 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="Display name (optional)" />
            <input v-model="form.username" class="h-9 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="Username / login" />
            <input v-model="form.password" type="password" class="h-9 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="Password / app password" />
            <input v-model="form.imapHost" class="h-9 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="IMAP host (imap.example.com)" />
            <div class="flex items-center gap-2">
              <input v-model.number="form.imapPort" type="number" class="h-9 w-24 rounded-md border border-input bg-background px-2.5 text-sm" />
              <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input v-model="form.imapSecure" type="checkbox" class="accent-primary" /> TLS
              </label>
            </div>
            <input v-model="form.smtpHost" class="h-9 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground" placeholder="SMTP host (smtp.example.com)" />
            <div class="flex items-center gap-2">
              <input v-model.number="form.smtpPort" type="number" class="h-9 w-24 rounded-md border border-input bg-background px-2.5 text-sm" />
              <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input v-model="form.smtpSecure" type="checkbox" class="accent-primary" /> TLS
              </label>
            </div>
          </div>

          <div v-if="testResult" class="flex items-center gap-1.5 text-xs" :class="testResult.ok ? 'text-emerald-600' : 'text-destructive'">
            <CheckCircle2 v-if="testResult.ok" class="h-4 w-4" />
            <XCircle v-else class="h-4 w-4" />
            {{ testResult.message }}
          </div>
          <div v-if="error" class="text-xs text-destructive">{{ error }}</div>

          <div class="flex gap-2">
            <Button variant="outline" size="sm" :disabled="testing" @click="testConnection">
              <Loader2 v-if="testing" class="h-4 w-4 animate-spin" />
              Test connection
            </Button>
            <Button variant="default" size="sm" :disabled="adding" @click="addAccount">
              <Loader2 v-if="adding" class="h-4 w-4 animate-spin" />
              Add
            </Button>
            <Button variant="ghost" size="sm" @click="showAdd = false">Cancel</Button>
          </div>
        </div>

        <!-- Account list -->
        <div v-if="accountsState.accounts.length === 0 && !showAdd" class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No accounts connected yet. Add your first email account to get started.
        </div>
        <div v-for="a in accountsState.accounts" :key="a.id" class="card-surface mb-2 flex items-center gap-3 p-3">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
            {{ a.name.charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{{ a.name }} <span class="text-muted-foreground">&lt;{{ a.email }}&gt;</span></div>
            <div class="text-xs text-muted-foreground">
              <span v-if="a.state === 'healthy'" class="text-emerald-600">Healthy</span>
              <span v-else-if="a.state === 'unavailable'" class="text-amber-600">{{ a.stateMessage || "Unavailable" }}</span>
              <span v-else-if="a.state === 'auth_required'" class="text-destructive">Authentication required</span>
              <span v-else>{{ a.state }}</span>
              <span v-if="a.lastSyncedAt" class="ml-2">Synced {{ formatDate(a.lastSyncedAt) }}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" class="h-8 w-8" @click="syncOne(a.id)" title="Sync now">
            <RefreshCw class="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" class="h-8 w-8 text-destructive" @click="remove(a.id)" title="Remove account">
            <Trash2 class="h-4 w-4" />
          </Button>
        </div>
      </section>
    </main>
  </div>
</template>