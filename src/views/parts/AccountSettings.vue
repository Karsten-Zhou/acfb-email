<script setup lang="ts">
// AccountSettings — the "Email accounts" section of Settings: OAuth connect
// cards, the IMAP/SMTP add form (with host comboboxes), the account list with
// per-account sync/remove, and the delete-confirmation dialog.
import { ref } from "vue";
import {
  accountsState,
  loadAccounts,
  removeAccount,
  moveAccount,
  updateAccount,
  syncAccount,
  markAccountSyncing,
  clearAccountSyncing,
} from "../../stores/accounts";
import { api, type HealthPayload } from "../../lib/api";
import { t, formatDate } from "../../lib/i18n";
import UiButton from "../../components/UiButton.vue";
import UiInput from "../../components/UiInput.vue";
import UiSwitch from "../../components/UiSwitch.vue";
import UiDialog from "../../components/UiDialog.vue";
import UiToolTip from "../../components/UiToolTip.vue";
import {
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  Eye,
  EyeOff,
  Inbox,
  Send,
  ArrowUp,
  ArrowDown,
  Pencil,
} from "lucide-vue-next";

defineProps<{
  meta: HealthPayload | null;
  notice: string | null;
}>();
const emit = defineEmits<{
  dismissNotice: [];
}>();

const showAdd = ref(false);
const adding = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
const error = ref<string | null>(null);
/** Last sync failure message per account id (shown under the row). */
const syncErrorMap = ref<Record<string, string>>({});
const confirmDeleteId = ref<string | null>(null);
/** Whether the confirm dialog is open (so the row can be deleted via modal). */
const deleteDialogOpen = ref(false);
const deleting = ref(false);

// --- edit account (label + display name) ---
/** The account being edited (null = dialog closed). */
const editAccount = ref<{ id: string; name: string; displayName: string | null } | null>(null);
const editDialogOpen = ref(false);
const editName = ref("");
const editDisplayName = ref("");
const savingEdit = ref(false);
const editError = ref<string | null>(null);

function openEdit(a: { id: string; name: string; displayName: string | null }) {
  editAccount.value = a;
  editName.value = a.name;
  editDisplayName.value = a.displayName ?? "";
  editError.value = null;
  editDialogOpen.value = true;
}

async function saveEdit() {
  if (!editAccount.value) return;
  savingEdit.value = true;
  editError.value = null;
  try {
    const name = editName.value.trim();
    if (!name) {
      editError.value = "Label is required";
      return;
    }
    // Label identifies the account in the sidebar; display name is the
    // from-name recipients see on sent mail. They're deliberately separate
    // (e.g. label "Work", display name "John Doe <john@example.com>").
    await updateAccount(editAccount.value.id, {
      name,
      displayName: editDisplayName.value.trim() || null,
    });
    editDialogOpen.value = false;
    editAccount.value = null;
    await loadAccounts();
  } catch (err) {
    editError.value = err instanceof Error ? err.message : "Failed to update account";
  } finally {
    savingEdit.value = false;
  }
}

function accountIndex(id: string): number {
  return accountsState.accounts.findIndex((a) => a.id === id);
}

async function reorder(id: string, dir: -1 | 1) {
  const idx = accountIndex(id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= accountsState.accounts.length) return;
  await moveAccount(id, dir);
}

// IMAP host suggestions (common providers) — the form itself starts empty.
const IMAP_HOSTS = [
  {
    label: "Gmail",
    imap: "imap.gmail.com",
    smtp: "smtp.gmail.com",
    imapPort: 993,
    smtpPort: 465,
    imapSecure: true,
    smtpSecure: true,
  },
  {
    label: "Outlook.com",
    imap: "outlook.office365.com",
    smtp: "smtp.office365.com",
    imapPort: 993,
    smtpPort: 587,
    imapSecure: true,
    smtpSecure: false,
  },
  {
    label: "Yahoo",
    imap: "imap.mail.yahoo.com",
    smtp: "smtp.mail.yahoo.com",
    imapPort: 993,
    smtpPort: 465,
    imapSecure: true,
    smtpSecure: true,
  },
  {
    label: "iCloud",
    imap: "imap.mail.me.com",
    smtp: "smtp.mail.me.com",
    imapPort: 993,
    smtpPort: 587,
    imapSecure: true,
    smtpSecure: false,
  },
  {
    label: "Zoho",
    imap: "imap.zoho.com",
    smtp: "smtp.zoho.com",
    imapPort: 993,
    smtpPort: 465,
    imapSecure: true,
    smtpSecure: true,
  },
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
const focusedHost = ref<"imap" | "smtp" | null>(null);

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
  // Optimistic: mark running immediately so the row spinner + "Syncing…"
  // appear right away and the poller switches to 1s cadence.
  markAccountSyncing(id);
  try {
    const res = await syncAccount(id);
    if (!res.ok && res.message) {
      syncErrorMap.value = { ...syncErrorMap.value, [id]: res.message };
    } else {
      syncErrorMap.value = { ...syncErrorMap.value, [id]: "" };
    }
  } finally {
    // Always drop fast mode — on success the server has settled the state and
    // the next poll applies its truth; on failure the state never went
    // 'running' server-side so fast polling must not persist (else 1s forever).
    clearAccountSyncing();
  }
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold">{{ t("emailAccounts") }}</h2>
      <UiButton variant="default" size="sm" @click="showAdd = !showAdd">
        <Plus class="h-4 w-4" /> {{ t("addAccount") }}
      </UiButton>
    </div>

    <div
      v-if="notice"
      class="mb-3 flex items-center justify-between gap-2 card-surface border-emerald-500/40 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400"
    >
      <span>{{ notice }}</span>
      <button class="text-muted-foreground hover:text-foreground" @click="emit('dismissNotice')">
        ✕
      </button>
    </div>

    <!-- OAuth providers -->
    <div class="card-surface mb-4 grid gap-3 p-4 sm:grid-cols-2">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t("connectGmail") }}</div>
          <div v-if="meta?.config.gmailOauth" class="text-xs text-muted-foreground">
            {{ t("connectGmailHint") }}
          </div>
          <div v-else class="text-xs text-muted-foreground">
            {{ t("oauthNotConfigured", { name: "Google" }) }}
          </div>
        </div>
        <UiToolTip
          :label="
            meta?.config.gmailOauth
              ? t('connectGmailHint')
              : t('oauthNotConfigured', { name: 'Google' })
          "
        >
          <UiButton
            variant="outline"
            size="sm"
            :disabled="!meta?.config.gmailOauth"
            @click="connectOAuth('google')"
            >{{ t("connect") }}</UiButton
          >
        </UiToolTip>
      </div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t("connectOutlook") }}</div>
          <div v-if="meta?.config.outlookOauth" class="text-xs text-muted-foreground">
            {{ t("connectOutlookHint") }}
          </div>
          <div v-else class="text-xs text-muted-foreground">
            {{ t("oauthNotConfigured", { name: "Microsoft" }) }}
          </div>
        </div>
        <UiToolTip
          :label="
            meta?.config.outlookOauth
              ? t('connectOutlookHint')
              : t('oauthNotConfigured', { name: 'Microsoft' })
          "
        >
          <UiButton
            variant="outline"
            size="sm"
            :disabled="!meta?.config.outlookOauth"
            @click="connectOAuth('microsoft')"
            >{{ t("connect") }}</UiButton
          >
        </UiToolTip>
      </div>
    </div>

    <!-- IMAP / SMTP add form -->
    <div v-if="showAdd" class="card-surface mb-4 space-y-4 p-4">
      <div>
        <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t("imapSection") }}
        </div>
        <div class="mb-2 flex flex-wrap gap-1.5">
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
            <label class="text-xs font-medium text-muted-foreground">{{ t("label") }}</label>
            <UiInput v-model="form.name" class="w-full" placeholder="e.g. Work" />
            <p class="text-xs text-muted-foreground/70">{{ t("labelHint") }}</p>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">{{ t("email") }}</label>
            <UiInput
              v-model="form.email"
              type="email"
              class="w-full"
              placeholder="you@example.com"
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">{{ t("displayName") }}</label>
            <UiInput v-model="form.displayName" class="w-full" />
            <p class="text-xs text-muted-foreground/70">{{ t("displayNameHint") }}</p>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">{{ t("username") }}</label>
            <UiInput v-model="form.username" class="w-full" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">{{ t("password") }}</label>
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
        <div class="mt-3 rounded-lg border border-border p-3">
          <div
            class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Inbox class="h-3.5 w-3.5" /> {{ t("imapGroup") }}
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="space-y-1 sm:col-span-2">
              <label class="text-xs font-medium text-muted-foreground">{{ t("imapHost") }}</label>
              <div class="relative">
                <Search
                  class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <UiInput
                  v-model="form.imapHost"
                  class="w-full pl-8"
                  :placeholder="'imap.example.com'"
                  @focus="focusedHost = 'imap'"
                  @blur="focusedHost = null"
                />
                <div
                  v-if="focusedHost === 'imap' && showOptions(form.imapHost)"
                  class="absolute top-full left-0 z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
                >
                  <button
                    v-for="opt in hostOptions(form.imapHost)"
                    :key="opt.value"
                    class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                    @mousedown.prevent="
                      form.imapHost = opt.value;
                      focusedHost = null;
                    "
                  >
                    <span>{{ opt.value }}</span>
                    <span class="text-muted-foreground">{{ opt.provider }}</span>
                  </button>
                </div>
              </div>
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-muted-foreground">{{ t("port") }}</label>
              <UiInput v-model.number="form.imapPort" type="number" class="w-full" />
            </div>
            <div class="flex items-end gap-2 pb-1">
              <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{{
                t("secure")
              }}</label>
              <UiSwitch v-model="form.imapSecure" />
            </div>
          </div>
        </div>

        <!-- SMTP group -->
        <div class="mt-3 rounded-lg border border-border p-3">
          <div
            class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Send class="h-3.5 w-3.5" /> {{ t("smtpGroup") }}
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="space-y-1 sm:col-span-2">
              <label class="text-xs font-medium text-muted-foreground">{{ t("smtpHost") }}</label>
              <div class="relative">
                <Search
                  class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <UiInput
                  v-model="form.smtpHost"
                  class="w-full pl-8"
                  :placeholder="'smtp.example.com'"
                  @focus="focusedHost = 'smtp'"
                  @blur="focusedHost = null"
                />
                <div
                  v-if="focusedHost === 'smtp' && showOptions(form.smtpHost)"
                  class="absolute top-full left-0 z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
                >
                  <button
                    v-for="opt in hostOptions(form.smtpHost)"
                    :key="opt.value"
                    class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                    @mousedown.prevent="
                      form.smtpHost = opt.value;
                      focusedHost = null;
                    "
                  >
                    <span>{{ opt.value }}</span>
                    <span class="text-muted-foreground">{{ opt.provider }}</span>
                  </button>
                </div>
              </div>
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-muted-foreground">{{ t("port") }}</label>
              <UiInput v-model.number="form.smtpPort" type="number" class="w-full" />
            </div>
            <div class="flex items-end gap-2 pb-1">
              <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{{
                t("secure")
              }}</label>
              <UiSwitch v-model="form.smtpSecure" />
            </div>
          </div>
        </div>

        <div
          v-if="testResult"
          class="mt-3 flex items-center gap-1.5 text-xs"
          :class="testResult.ok ? 'text-emerald-600' : 'text-destructive'"
        >
          <CheckCircle2 v-if="testResult.ok" class="h-4 w-4" />
          <XCircle v-else class="h-4 w-4" />
          {{ testResult.message }}
        </div>
        <div v-if="error" class="mt-1 text-xs text-destructive">{{ error }}</div>

        <div class="mt-3 flex gap-2">
          <UiButton variant="outline" size="sm" :disabled="testing" @click="testConnection">
            <Loader2 v-if="testing" class="h-4 w-4 animate-spin" />
            {{ testing ? t("testing") : t("testConnection") }}
          </UiButton>
          <UiButton variant="default" size="sm" :disabled="adding" @click="addAccount">
            <Loader2 v-if="adding" class="h-4 w-4 animate-spin" /> {{ t("addAccount") }}
          </UiButton>
          <UiButton variant="ghost" size="sm" @click="showAdd = false">{{ t("cancel") }}</UiButton>
        </div>
      </div>
    </div>

    <!-- Account list -->
    <div
      v-if="accountsState.accounts.length === 0 && !showAdd"
      class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
    >
      {{ t("emailAccounts") }}
    </div>
    <div
      v-for="a in accountsState.accounts"
      :key="a.id"
      class="card-surface mb-2 flex items-center gap-3 p-3"
    >
      <div
        class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary"
      >
        {{ a.name.charAt(0).toUpperCase() }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium">
          {{ a.name }} <span class="text-muted-foreground">&lt;{{ a.email }}&gt;</span>
        </div>
        <div class="text-xs text-muted-foreground">
          <span v-if="a.state === 'healthy'" class="text-emerald-600">{{ t("healthy") }}</span>
          <span
            v-else-if="a.state === 'running'"
            class="inline-flex items-center gap-1 text-sky-600"
          >
            <Loader2 class="h-3 w-3 animate-spin" /> {{ t("syncing") }}
          </span>
          <span v-else-if="a.state === 'unavailable'" class="text-amber-600">{{
            a.stateMessage || t("unavailable")
          }}</span>
          <span v-else-if="a.state === 'auth_required'" class="text-destructive">{{
            t("authRequired")
          }}</span>
          <span v-else>{{ a.state }}</span>
          <span v-if="a.lastSyncedAt" class="ml-2"
            >{{ t("syncedOn") }} {{ formatDate(a.lastSyncedAt) }}</span
          >
        </div>
        <div
          v-if="syncErrorMap[a.id]"
          class="mt-0.5 flex items-center gap-1.5 text-xs text-destructive"
        >
          <XCircle class="h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0 truncate">{{ syncErrorMap[a.id] }}</span>
        </div>
      </div>
      <UiToolTip :label="a.state === 'running' ? t('syncing') : t('syncNow')">
        <UiButton
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :disabled="a.state === 'running'"
          @click="syncOne(a.id)"
        >
          <Loader2 v-if="a.state === 'running'" class="h-4 w-4 animate-spin" />
          <RefreshCw v-else class="h-4 w-4" />
        </UiButton>
      </UiToolTip>
      <div class="flex flex-col">
        <UiToolTip :label="t('moveUp')">
          <UiButton
            variant="ghost"
            size="icon"
            class="h-6 w-6"
            :disabled="accountIndex(a.id) === 0"
            @click="reorder(a.id, -1)"
          >
            <ArrowUp class="h-3.5 w-3.5" />
          </UiButton>
        </UiToolTip>
        <UiToolTip :label="t('moveDown')">
          <UiButton
            variant="ghost"
            size="icon"
            class="h-6 w-6"
            :disabled="accountIndex(a.id) === accountsState.accounts.length - 1"
            @click="reorder(a.id, 1)"
          >
            <ArrowDown class="h-3.5 w-3.5" />
          </UiButton>
        </UiToolTip>
      </div>
      <UiToolTip :label="t('editAccount')">
        <UiButton variant="ghost" size="icon" class="h-8 w-8" @click="openEdit(a)">
          <Pencil class="h-4 w-4" />
        </UiButton>
      </UiToolTip>
      <UiToolTip :label="t('removeAccount')">
        <UiButton
          variant="ghost"
          size="icon"
          class="h-8 w-8 text-destructive hover:bg-destructive hover:text-white"
          @click="askRemoveAccount(a.id)"
        >
          <Trash2 class="h-4 w-4" />
        </UiButton>
      </UiToolTip>
    </div>

    <!-- Modal delete confirmation -->
    <UiDialog
      :open="deleteDialogOpen"
      :title="t('confirmDeleteAccount')"
      :busy="deleting"
      @close="deleteDialogOpen = false"
    >
      <p class="text-sm text-muted-foreground">{{ t("confirmDeleteAccount") }}</p>
      <template #footer>
        <UiButton
          variant="ghost"
          size="sm"
          :disabled="deleting"
          @click="deleteDialogOpen = false"
          >{{ t("cancelAction") }}</UiButton
        >
        <UiButton variant="destructive" size="sm" :disabled="deleting" @click="confirmRemove">
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" /> {{ t("ok") }}
        </UiButton>
      </template>
    </UiDialog>

    <!-- Modal edit account (label + display name) -->
    <UiDialog
      :open="editDialogOpen"
      :title="t('editAccount')"
      :busy="savingEdit"
      @close="editDialogOpen = false"
    >
      <div class="space-y-3">
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground">{{ t("label") }}</label>
          <UiInput v-model="editName" class="w-full" maxlength="100" />
          <p class="text-xs text-muted-foreground/70">{{ t("labelHint") }}</p>
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground">{{ t("displayName") }}</label>
          <UiInput v-model="editDisplayName" class="w-full" maxlength="100" />
          <p class="text-xs text-muted-foreground/70">{{ t("displayNameHint") }}</p>
        </div>
        <div v-if="editError" class="text-xs text-destructive">{{ editError }}</div>
      </div>
      <template #footer>
        <UiButton
          variant="ghost"
          size="sm"
          :disabled="savingEdit"
          @click="editDialogOpen = false"
          >{{ t("cancelAction") }}</UiButton
        >
        <UiButton variant="default" size="sm" :disabled="savingEdit" @click="saveEdit">
          <Loader2 v-if="savingEdit" class="h-4 w-4 animate-spin" /> {{ t("save") }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
