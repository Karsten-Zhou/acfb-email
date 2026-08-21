<script setup lang="ts">
// Settings view: accounts (IMAP + OAuth), preferences (theme/language), about.
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { accountsState, loadAccounts, removeAccount, syncAccount } from "../stores/accounts";
import { logout } from "../stores/auth";
import { api, type HealthPayload } from "../lib/api";
import { t, setLocale, localeState, supportedLocales, type LocaleSetting } from "../lib/i18n";
import { themeState, setTheme, type ThemeSetting } from "../lib/theme";
import Button from "../components/ui/button/AppButton.vue";
import {
  ChevronLeft,
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Sun,
  Moon,
  Monitor,
  Languages,
  Info,
  ExternalLink,
} from "lucide-vue-next";

const router = useRouter();

const showAdd = ref(false);
const adding = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const syncingId = ref<string | null>(null);
const confirmDeleteId = ref<string | null>(null);
const meta = ref<HealthPayload | null>(null);

// IMAP host suggestions (common providers) — the form itself starts empty.
const IMAP_HOSTS = [
  { label: "Gmail", imap: "imap.gmail.com", smtp: "smtp.gmail.com", imapPort: 993, smtpPort: 465 },
  { label: "Outlook.com", imap: "outlook.office365.com", smtp: "smtp.office365.com", imapPort: 993, smtpPort: 587 },
  { label: "Yahoo", imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com", imapPort: 993, smtpPort: 465 },
  { label: "iCloud", imap: "imap.mail.me.com", smtp: "smtp.mail.me.com", imapPort: 993, smtpPort: 587 },
  { label: "Zoho", imap: "imap.zoho.com", smtp: "smtp.zoho.com", imapPort: 993, smtpPort: 465 },
] as const;

const form = ref({
  name: "",
  email: "",
  displayName: "",
  imapHost: "",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
  username: "",
  password: "",
});

function applyPreset(p: (typeof IMAP_HOSTS)[number]) {
  form.value.imapHost = p.imap;
  form.value.smtpHost = p.smtp;
  form.value.imapPort = p.imapPort;
  form.value.smtpPort = p.smtpPort;
}

onMounted(async () => {
  await Promise.all([loadAccounts(), api.health().then((h) => (meta.value = h)).catch(() => null)]);
  const connected = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("connected");
  if (connected === "google" || connected === "microsoft") {
    notice.value = connected === "google" ? t("connectGmail") + " ✓" : t("connectOutlook") + " ✓";
    window.setTimeout(() => (notice.value = null), 4000);
  }
});

const localeValue = computed({
  get: () => localeState.value.setting,
  set: (v: LocaleSetting) => setLocale(v),
});
const themeValue = computed({
  get: () => themeState.setting,
  set: (v: ThemeSetting) => setTheme(v),
});

async function connectOAuth(provider: "google" | "microsoft") {
  window.location.href = `/api/oauth/${provider}/start`;
}

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    const res = await api.testAccount({ provider: "imap", ...form.value });
    testResult.value = { ok: res.ok, message: res.message ?? "OK" };
  } catch (err) {
    testResult.value = { ok: false, message: err instanceof Error ? err.message : String(err) };
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

async function confirmRemove() {
  if (!confirmDeleteId.value) return;
  await removeAccount(confirmDeleteId.value);
  confirmDeleteId.value = null;
}

async function syncOne(id: string) {
  syncingId.value = id;
  try {
    await syncAccount(id);
    await loadAccounts();
  } finally {
    syncingId.value = null;
  }
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
      <Button variant="ghost" size="icon" class="h-8 w-8" @click="router.push({ name: 'mailbox' })" :title="t('settings')">
        <ChevronLeft class="h-4 w-4" />
      </Button>
      <h1 class="text-sm font-semibold">{{ t('settings') }}</h1>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" class="text-destructive" @click="doLogout">{{ t('signOut') }}</Button>
    </header>

    <main class="flex-1 overflow-y-auto p-4 md:p-6">
      <section class="mx-auto max-w-2xl space-y-6">
        <!-- Accounts -->
        <div>
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold">{{ t('emailAccounts') }}</h2>
            <Button variant="default" size="sm" @click="showAdd = !showAdd">
              <Plus class="h-4 w-4" /> {{ t('addAccount') }}
            </Button>
          </div>

          <div v-if="notice" class="card-surface mb-3 border-emerald-500/40 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
            {{ notice }}
          </div>

          <!-- OAuth providers -->
          <div class="card-surface mb-4 grid gap-3 p-4 sm:grid-cols-2">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm font-medium">{{ t('connectGmail') }}</div>
                <div v-if="meta?.config.gmailOauth" class="text-xs text-muted-foreground">{{ t('connectGmailHint') }}</div>
                <div v-else class="text-xs text-muted-foreground">{{ t('oauthNotConfigured', { name: 'Google' }) }}</div>
              </div>
              <Button variant="outline" size="sm" :disabled="!meta?.config.gmailOauth" @click="connectOAuth('google')">{{ t('connect') }}</Button>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm font-medium">{{ t('connectOutlook') }}</div>
                <div v-if="meta?.config.outlookOauth" class="text-xs text-muted-foreground">{{ t('connectOutlookHint') }}</div>
                <div v-else class="text-xs text-muted-foreground">{{ t('oauthNotConfigured', { name: 'Microsoft' }) }}</div>
              </div>
              <Button variant="outline" size="sm" :disabled="!meta?.config.outlookOauth" @click="connectOAuth('microsoft')">{{ t('connect') }}</Button>
            </div>
          </div>

          <div class="mb-2 text-sm text-muted-foreground">{{ t('imapSection') }}</div>

          <!-- Add form -->
          <div v-if="showAdd" class="card-surface mb-4 space-y-3 p-4">
            <div class="flex flex-wrap gap-1.5">
              <span class="text-xs text-muted-foreground">{{ t('imapHost') }}:</span>
              <button
                v-for="p in IMAP_HOSTS"
                :key="p.label"
                class="rounded-md border border-input px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                @click="applyPreset(p)"
              >
                {{ p.label }}
              </button>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('label') }}</label>
                <input v-model="form.name" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :placeholder="'e.g. Work'" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('email') }}</label>
                <input v-model="form.email" type="email" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :placeholder="'you@example.com'" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('displayName') }}</label>
                <input v-model="form.displayName" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('username') }}</label>
                <input v-model="form.username" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('password') }}</label>
                <input v-model="form.password" type="password" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :placeholder="'••••••••'" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('imapHost') }}</label>
                <input v-model="form.imapHost" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :placeholder="'imap.example.com'" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('smtpHost') }}</label>
                <input v-model="form.smtpHost" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :placeholder="'smtp.example.com'" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">IMAP {{ t('imapTls') }} · {{ t('smtpHost') }} ports</label>
                <div class="flex items-center gap-2">
                  <label class="flex items-center gap-1.5 text-xs text-muted-foreground">{{ t('imapTls') }} <input v-model="form.imapSecure" type="checkbox" class="accent-primary" /></label>
                  <label class="flex items-center gap-1.5 text-xs text-muted-foreground">{{ t('smtpTls') }} <input v-model="form.smtpSecure" type="checkbox" class="accent-primary" /></label>
                </div>
              </div>
              <div class="flex gap-2">
                <label class="flex-1 space-y-1 text-xs font-medium text-muted-foreground">{{ t('imapHost') }} port
                  <input v-model.number="form.imapPort" type="number" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm" />
                </label>
                <label class="flex-1 space-y-1 text-xs font-medium text-muted-foreground">{{ t('smtpHost') }} port
                  <input v-model.number="form.smtpPort" type="number" class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm" />
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
                <Loader2 v-if="testing" class="h-4 w-4 animate-spin" /> {{ testing ? t('testing') : t('testConnection') }}
              </Button>
              <Button variant="default" size="sm" :disabled="adding" @click="addAccount">
                <Loader2 v-if="adding" class="h-4 w-4 animate-spin" /> {{ t('addAccount') }}
              </Button>
              <Button variant="ghost" size="sm" @click="showAdd = false">{{ t('cancel') }}</Button>
            </div>
          </div>

          <!-- Account list -->
          <div v-if="accountsState.accounts.length === 0 && !showAdd" class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {{ t('emailAccounts') }}
          </div>
          <!-- delete confirm dialog -->
          <div v-if="confirmDeleteId" class="card-surface mb-4 border-destructive/40 p-4">
            <p class="text-sm">{{ t('confirmDeleteAccount') }}</p>
            <div class="mt-3 flex gap-2">
              <Button variant="destructive" size="sm" @click="confirmRemove">{{ t('ok') }}</Button>
              <Button variant="ghost" size="sm" @click="confirmDeleteId = null">{{ t('cancel') }}</Button>
            </div>
          </div>
          <div v-for="a in accountsState.accounts" :key="a.id" class="card-surface mb-2 flex items-center gap-3 p-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
              {{ a.name.charAt(0).toUpperCase() }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ a.name }} <span class="text-muted-foreground">&lt;{{ a.email }}&gt;</span></div>
              <div class="text-xs text-muted-foreground">
                <span v-if="a.state === 'healthy'" class="text-emerald-600">{{ t('healthy') }}</span>
                <span v-else-if="a.state === 'unavailable'" class="text-amber-600">{{ a.stateMessage || t('unavailable') }}</span>
                <span v-else-if="a.state === 'auth_required'" class="text-destructive">{{ t('authRequired') }}</span>
                <span v-else>{{ a.state }}</span>
                <span v-if="a.lastSyncedAt" class="ml-2">{{ t('syncedOn') }} {{ formatDate(a.lastSyncedAt) }}</span>
              </div>
            </div>
            <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="syncingId === a.id" :title="t('syncNow')" @click="syncOne(a.id)">
              <Loader2 v-if="syncingId === a.id" class="h-4 w-4 animate-spin" />
              <RefreshCw v-else class="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:bg-destructive hover:text-white" :title="t('removeAccount')" @click="confirmDeleteId = a.id">
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <!-- Preferences -->
        <div class="card-surface p-4">
          <h2 class="mb-3 text-sm font-semibold">Preferences</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Languages class="h-3.5 w-3.5" /> {{ t('language') }}
              </label>
              <select v-model="localeValue" class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="auto">{{ t('languageAuto') }}</option>
                <option v-for="l in supportedLocales" :key="l" :value="l">{{ l.toUpperCase() }}</option>
              </select>
            </div>
            <div class="space-y-2">
              <label class="text-xs font-medium text-muted-foreground">{{ t('theme') }}</label>
              <div class="flex gap-1.5">
                <button
                  class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
                  :class="themeValue === 'light' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'"
                  @click="themeValue = 'light'"
                  :title="t('themeLight')"
                >
                  <Sun class="h-3.5 w-3.5" /> {{ t('themeLight') }}
                </button>
                <button
                  class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
                  :class="themeValue === 'dark' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'"
                  @click="themeValue = 'dark'"
                  :title="t('themeDark')"
                >
                  <Moon class="h-3.5 w-3.5" /> {{ t('themeDark') }}
                </button>
                <button
                  class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
                  :class="themeValue === 'auto' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'"
                  @click="themeValue = 'auto'"
                  :title="t('themeAuto')"
                >
                  <Monitor class="h-3.5 w-3.5" /> {{ t('themeAuto') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- About -->
        <div class="card-surface p-4">
          <h2 class="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Info class="h-4 w-4" /> {{ t('about') }}
          </h2>
          <dl class="space-y-1.5 text-sm">
            <div class="flex justify-between"><dt class="text-muted-foreground">{{ t('appName') }}</dt><dd class="font-medium">Cloudflare Email Client</dd></div>
            <div class="flex justify-between"><dt class="text-muted-foreground">{{ t('version') }}</dt><dd class="font-medium">{{ meta?.version || '0.1.0' }}</dd></div>
            <div class="flex justify-between"><dt class="text-muted-foreground">{{ t('buildTime') }}</dt><dd class="font-medium">{{ meta?.buildTime ? new Date(meta.buildTime).toLocaleString() : '—' }}</dd></div>
          </dl>
          <a
            v-if="meta?.repo"
            :href="meta.repo"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-3 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink class="h-4 w-4" /> {{ t('viewSource') }}
          </a>
        </div>
      </section>
    </main>
  </div>
</template>