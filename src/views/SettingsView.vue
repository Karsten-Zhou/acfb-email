<script setup lang="ts">
// Settings view: accounts (IMAP + OAuth), preferences (theme/language), about.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { accountsState, loadAccounts, removeAccount, syncAccount } from "../stores/accounts";
import { logout } from "../stores/auth";
import { api, type HealthPayload } from "../lib/api";
import { t, setLocale, localeState, supportedLocales, type LocaleSetting } from "../lib/i18n";
import { themeState, setTheme, type ThemeSetting } from "../lib/theme";
import UiButton from "../components/UiButton.vue";
import UiInput from "../components/UiInput.vue";
import UiSwitch from "../components/UiSwitch.vue";
import UiDialog from "../components/UiDialog.vue";
import UiToolTip from "../components/UiToolTip.vue";
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
  Search,
  Eye,
  EyeOff,
  ChevronDown,
  Check,
  Inbox,
  Send,
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
/** Whether the confirm dialog is open (so the row can be deleted via modal). */
const deleteDialogOpen = ref(false);
const deleting = ref(false);
const meta = ref<HealthPayload | null>(null);

// Static app metadata (frontend-only; no backend round-trip needed).
const APP_REPO_URL = "https://github.com/XiaoSong-CPE/cloudflare-email-client";

// IMAP host suggestions (common providers) — the form itself starts empty.
const IMAP_HOSTS = [
  { label: "Gmail", imap: "imap.gmail.com", smtp: "smtp.gmail.com", imapPort: 993, smtpPort: 465, imapSecure: true, smtpSecure: true },
  { label: "Outlook.com", imap: "outlook.office365.com", smtp: "smtp.office365.com", imapPort: 993, smtpPort: 587, imapSecure: true, smtpSecure: false },
  { label: "Yahoo", imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com", imapPort: 993, smtpPort: 465, imapSecure: true, smtpSecure: true },
  { label: "iCloud", imap: "imap.mail.me.com", smtp: "smtp.mail.me.com", imapPort: 993, smtpPort: 587, imapSecure: true, smtpSecure: false },
  { label: "Zoho", imap: "imap.zoho.com", smtp: "smtp.zoho.com", imapPort: 993, smtpPort: 465, imapSecure: true, smtpSecure: true },
] as const;

/** Hosts offered when the host boxes are empty or prefix-matched. */
const HOST_OPTIONS = IMAP_HOSTS.map((p) => ({ value: p.imap, provider: p.label }));

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
const showPassword = ref(false);

function applyPreset(p: (typeof IMAP_HOSTS)[number]) {
  form.value.imapHost = p.imap;
  form.value.smtpHost = p.smtp;
  form.value.imapPort = p.imapPort;
  form.value.smtpPort = p.smtpPort;
  form.value.imapSecure = p.imapSecure;
  form.value.smtpSecure = p.smtpSecure;
}

/** Host-option list shown under a host field (empty or prefix match). */
function hostOptions(value: string): { value: string; provider: string }[] {
  const v = value.trim().toLowerCase();
  if (!v) return HOST_OPTIONS.map((h) => ({ ...h }));
  return HOST_OPTIONS.filter((h) => h.value.toLowerCase().startsWith(v)).map((h) => ({ ...h }));
}

/** True when the box should show the dropdown list (has matches). */
function showOptions(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "" || HOST_OPTIONS.some((h) => h.value.toLowerCase().startsWith(v));
}

const focusedHost = ref<"imap" | "smtp" | null>(null);

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

/** Native-language labels for the language dropdown (Intl, no hardcoded list). */
function languageLabel(locale: LocaleSetting): string {
  if (locale === "auto") {
    const current = detectActiveLocale();
    const name = new Intl.DisplayNames([current], { type: "language" }).of(current) ?? current;
    return `${t("languageAuto")} · ${name}`;
  }
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  // Capitalize display name for a nicer UI (e.g. "Deutsch", "中文", "English").
  return name.charAt(0).toUpperCase() + name.slice(1);
}
function detectActiveLocale(): string {
  return localeState.value.locale;
}
const languageMenuOpen = ref(false);
const languageMenuRef = ref<HTMLElement | null>(null);

function toggleLanguageMenu() {
  languageMenuOpen.value = !languageMenuOpen.value;
}
function pickLanguage(v: LocaleSetting) {
  setLocale(v);
  languageMenuOpen.value = false;
}
/* Close the language dropdown on outside click. */
function onDocClick(e: MouseEvent) {
  if (languageMenuRef.value && !languageMenuRef.value.contains(e.target as Node)) {
    languageMenuOpen.value = false;
  }
}
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));

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

function askRemoveAccount(id: string) {
  confirmDeleteId.value = id;
  deleteDialogOpen.value = true;
}

async function confirmRemove() {
  if (!confirmDeleteId.value) return;
  deleting.value = true;
  try {
    await removeAccount(confirmDeleteId.value);
    confirmDeleteId.value = null;
    deleteDialogOpen.value = false;
  } finally {
    deleting.value = false;
  }
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

// About
const appVersion = __APP_VERSION__;
const appBuildTime = __APP_BUILD_TIME__;
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <header class="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
      <UiToolTip :label="t('settings')">
        <UiButton variant="ghost" size="icon" class="h-8 w-8" @click="router.push({ name: 'mailbox' })">
          <ChevronLeft class="h-4 w-4" />
        </UiButton>
      </UiToolTip>
      <h1 class="text-sm font-semibold">{{ t('settings') }}</h1>
      <div class="flex-1" />
      <UiToolTip :label="t('signOut')">
        <UiButton variant="ghost" size="sm" class="text-destructive" @click="doLogout">{{ t('signOut') }}</UiButton>
      </UiToolTip>
    </header>

    <main class="flex-1 overflow-y-auto p-4 md:p-6">
      <section class="mx-auto max-w-2xl space-y-6">
        <!-- Accounts -->
        <div>
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold">{{ t('emailAccounts') }}</h2>
            <UiToolTip :label="t('addAccount')">
              <UiButton variant="default" size="sm" @click="showAdd = !showAdd">
                <Plus class="h-4 w-4" /> {{ t('addAccount') }}
              </UiButton>
            </UiToolTip>
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
              <UiToolTip :label="meta?.config.gmailOauth ? t('connectGmailHint') : t('oauthNotConfigured', { name: 'Google' })">
                <UiButton variant="outline" size="sm" :disabled="!meta?.config.gmailOauth" @click="connectOAuth('google')">{{ t('connect') }}</UiButton>
              </UiToolTip>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm font-medium">{{ t('connectOutlook') }}</div>
                <div v-if="meta?.config.outlookOauth" class="text-xs text-muted-foreground">{{ t('connectOutlookHint') }}</div>
                <div v-else class="text-xs text-muted-foreground">{{ t('oauthNotConfigured', { name: 'Microsoft' }) }}</div>
              </div>
              <UiToolTip :label="meta?.config.outlookOauth ? t('connectOutlookHint') : t('oauthNotConfigured', { name: 'Microsoft' })">
                <UiButton variant="outline" size="sm" :disabled="!meta?.config.outlookOauth" @click="connectOAuth('microsoft')">{{ t('connect') }}</UiButton>
              </UiToolTip>
            </div>
          </div>

          <div class="mb-2 text-sm text-muted-foreground">{{ t('imapSection') }}</div>

          <!-- Add form -->
          <div v-if="showAdd" class="card-surface mb-4 space-y-4 p-4">
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

            <!-- Account basics -->
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('label') }}</label>
                <UiInput v-model="form.name" class="w-full" placeholder="e.g. Work" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('email') }}</label>
                <UiInput v-model="form.email" type="email" class="w-full" placeholder="you@example.com" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('displayName') }}</label>
                <UiInput v-model="form.displayName" class="w-full" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('username') }}</label>
                <UiInput v-model="form.username" class="w-full" />
              </div>
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">{{ t('password') }}</label>
                <div class="relative">
                  <UiInput
                    v-model="form.password"
                    :type="showPassword ? 'text' : 'password'"
                    class="w-full pr-9"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    :aria-label="showPassword ? t('hidePassword') : t('showPassword')"
                    @click="showPassword = !showPassword"
                  >
                    <EyeOff v-if="showPassword" class="h-4 w-4" />
                    <Eye v-else class="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <!-- IMAP group -->
            <div class="rounded-lg border border-border p-3">
              <div class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Inbox class="h-3.5 w-3.5" /> {{ t('imapGroup') }}
              </div>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div class="space-y-1 sm:col-span-2">
                  <label class="text-xs font-medium text-muted-foreground">{{ t('imapHost') }}</label>
                  <div class="relative">
                    <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <UiInput v-model="form.imapHost" class="w-full pl-8" :placeholder="'imap.example.com'" @focus="focusedHost = 'imap'" @blur="focusedHost = null" />
                    <div
                      v-if="focusedHost === 'imap' && showOptions(form.imapHost)"
                      class="absolute top-full left-0 z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
                    >
                      <button
                        v-for="opt in hostOptions(form.imapHost)"
                        :key="opt.value"
                        class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                        @mousedown.prevent="form.imapHost = opt.value; focusedHost = null"
                      >
                        <span>{{ opt.value }}</span>
                        <span class="text-muted-foreground">{{ opt.provider }}</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="text-xs font-medium text-muted-foreground">{{ t('port') }}</label>
                  <UiInput v-model.number="form.imapPort" type="number" class="w-full" />
                </div>
                <div class="flex items-end gap-2 pb-1">
                  <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{{ t('secure') }}</label>
                  <UiSwitch v-model="form.imapSecure" />
                </div>
              </div>
            </div>

            <!-- SMTP group -->
            <div class="rounded-lg border border-border p-3">
              <div class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Send class="h-3.5 w-3.5" /> {{ t('smtpGroup') }}
              </div>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div class="space-y-1 sm:col-span-2">
                  <label class="text-xs font-medium text-muted-foreground">{{ t('smtpHost') }}</label>
                  <div class="relative">
                    <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <UiInput v-model="form.smtpHost" class="w-full pl-8" :placeholder="'smtp.example.com'" @focus="focusedHost = 'smtp'" @blur="focusedHost = null" />
                    <div
                      v-if="focusedHost === 'smtp' && showOptions(form.smtpHost)"
                      class="absolute top-full left-0 z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
                    >
                      <button
                        v-for="opt in hostOptions(form.smtpHost)"
                        :key="opt.value"
                        class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                        @mousedown.prevent="form.smtpHost = opt.value; focusedHost = null"
                      >
                        <span>{{ opt.value }}</span>
                        <span class="text-muted-foreground">{{ opt.provider }}</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="text-xs font-medium text-muted-foreground">{{ t('port') }}</label>
                  <UiInput v-model.number="form.smtpPort" type="number" class="w-full" />
                </div>
                <div class="flex items-end gap-2 pb-1">
                  <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{{ t('secure') }}</label>
                  <UiSwitch v-model="form.smtpSecure" />
                </div>
              </div>
            </div>

            <div v-if="testResult" class="flex items-center gap-1.5 text-xs" :class="testResult.ok ? 'text-emerald-600' : 'text-destructive'">
              <CheckCircle2 v-if="testResult.ok" class="h-4 w-4" />
              <XCircle v-else class="h-4 w-4" />
              {{ testResult.message }}
            </div>
            <div v-if="error" class="text-xs text-destructive">{{ error }}</div>

            <div class="flex gap-2">
              <UiButton variant="outline" size="sm" :disabled="testing" @click="testConnection">
                <Loader2 v-if="testing" class="h-4 w-4 animate-spin" /> {{ testing ? t('testing') : t('testConnection') }}
              </UiButton>
              <UiButton variant="default" size="sm" :disabled="adding" @click="addAccount">
                <Loader2 v-if="adding" class="h-4 w-4 animate-spin" /> {{ t('addAccount') }}
              </UiButton>
              <UiButton variant="ghost" size="sm" @click="showAdd = false">{{ t('cancel') }}</UiButton>
            </div>
          </div>

          <!-- Account list -->
          <div v-if="accountsState.accounts.length === 0 && !showAdd" class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {{ t('emailAccounts') }}
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
            <UiToolTip :label="t('syncNow')">
              <UiButton variant="ghost" size="icon" class="h-8 w-8" :disabled="syncingId === a.id" @click="syncOne(a.id)">
                <Loader2 v-if="syncingId === a.id" class="h-4 w-4 animate-spin" />
                <RefreshCw v-else class="h-4 w-4" />
              </UiButton>
            </UiToolTip>
            <UiToolTip :label="t('removeAccount')">
              <UiButton variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:bg-destructive hover:text-white" @click="askRemoveAccount(a.id)">
                <Trash2 class="h-4 w-4" />
              </UiButton>
            </UiToolTip>
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
              <!-- Nice language dropdown (Intl-named options) -->
              <div ref="languageMenuRef" class="relative">
                <button
                  type="button"
                  class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 text-sm"
                  @click.stop="toggleLanguageMenu"
                >
                  <span>{{ languageLabel(localeValue) }}</span>
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <Transition
                  enter-active-class="transition-opacity duration-100"
                  leave-active-class="transition-opacity duration-75"
                  enter-from-class="opacity-0"
                  leave-to-class="opacity-0"
                >
                  <div
                    v-if="languageMenuOpen"
                    class="absolute top-full left-0 z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md"
                  >
                    <button
                      class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      :class="localeValue === 'auto' ? 'bg-accent text-accent-foreground' : ''"
                      @click="pickLanguage('auto')"
                    >
                      <span>{{ languageLabel('auto') }}</span>
                      <Check v-if="localeValue === 'auto'" class="h-4 w-4 text-primary" />
                    </button>
                    <button
                      v-for="l in supportedLocales"
                      :key="l"
                      class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      :class="localeValue === l ? 'bg-accent text-accent-foreground' : ''"
                      @click="pickLanguage(l)"
                    >
                      <span>{{ languageLabel(l) }}</span>
                      <Check v-if="localeValue === l" class="h-4 w-4 text-primary" />
                    </button>
                  </div>
                </Transition>
              </div>
            </div>
            <div class="space-y-2">
              <label class="text-xs font-medium text-muted-foreground">{{ t('theme') }}</label>
              <div class="flex gap-1.5">
                <UiToolTip :label="t('themeAuto')">
                  <button
                    class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
                    :class="themeValue === 'auto' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'"
                    @click="themeValue = 'auto'"
                  >
                    <Monitor class="h-3.5 w-3.5" /> {{ t('themeAuto') }}
                  </button>
                </UiToolTip>
                <UiToolTip :label="t('themeLight')">
                  <button
                    class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
                    :class="themeValue === 'light' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'"
                    @click="themeValue = 'light'"
                  >
                    <Sun class="h-3.5 w-3.5" /> {{ t('themeLight') }}
                  </button>
                </UiToolTip>
                <UiToolTip :label="t('themeDark')">
                  <button
                    class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs"
                    :class="themeValue === 'dark' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'"
                    @click="themeValue = 'dark'"
                  >
                    <Moon class="h-3.5 w-3.5" /> {{ t('themeDark') }}
                  </button>
                </UiToolTip>
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
            <div class="flex justify-between"><dt class="text-muted-foreground">{{ t('version') }}</dt><dd class="font-medium">{{ appVersion }}</dd></div>
            <div class="flex justify-between"><dt class="text-muted-foreground">{{ t('buildTime') }}</dt><dd class="font-medium">{{ new Date(appBuildTime).toLocaleString() }}</dd></div>
          </dl>
          <a
            :href="APP_REPO_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-3 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink class="h-4 w-4" /> {{ t('viewSource') }}
          </a>
        </div>
      </section>
    </main>

    <!-- Modal delete confirmation -->
    <UiDialog
      :open="deleteDialogOpen"
      :title="t('confirmDeleteAccount')"
      :busy="deleting"
      @close="deleteDialogOpen = false"
    >
      <p class="text-sm text-muted-foreground">{{ t('confirmDeleteAccount') }}</p>
      <template #footer>
        <UiButton variant="ghost" size="sm" :disabled="deleting" @click="deleteDialogOpen = false">{{ t('cancelAction') }}</UiButton>
        <UiButton variant="destructive" size="sm" :disabled="deleting" @click="confirmRemove">
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" /> {{ t('ok') }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>