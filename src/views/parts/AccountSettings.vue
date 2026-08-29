<script setup lang="ts">
// AccountSettings — the "Email accounts" section of Settings: OAuth connect
// cards, the IMAP/SMTP add form (with host comboboxes), the account list with
// per-account sync/remove, and the delete-confirmation dialog.
import { ref } from "vue";
import {
  useAccountSummaries,
  useAddAccount,
  useDeleteAccount,
  useUpdateAccount,
  useReorderAccounts,
  useSyncAccounts,
} from "../../stores/accounts";
import { api, type HealthPayload } from "../../lib/api";
import { t, formatDate, syncErrorLabel } from "../../lib/i18n";
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
} from "@lucide/vue";

defineProps<{
  meta: HealthPayload | null;
}>();

const showAdd = ref(false);
const adding = ref(false);
const testing = ref(false);
/** Shared message for the IMAP form: test-connection result or add-account error. */
const formMessage = ref<{ ok: boolean; message: string } | null>(null);
const confirmDeleteId = ref<string | null>(null);
/** Whether the confirm dialog is open (so the row can be deleted via modal). */
const deleteDialogOpen = ref(false);

// ---- server state (TanStack Query) ----
/** Accounts merged with live sync state — drives row spinners + status text. */
const { data: accounts } = useAccountSummaries();
const { mutateAsync: addAccountMutation } = useAddAccount();
const { mutateAsync: removeAccount, isPending: deleting } = useDeleteAccount();
const { mutateAsync: updateAccount, isPending: savingEdit } = useUpdateAccount();
const { mutate: reorderAccounts } = useReorderAccounts();
const { mutate: syncAccount } = useSyncAccounts();

// --- edit account (label + display name) ---
/** The account being edited (null = dialog closed). */
const editAccount = ref<{ id: string; name: string; displayName: string | null } | null>(null);
const editDialogOpen = ref(false);
const editName = ref("");
const editDisplayName = ref("");
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
  const name = editName.value.trim();
  if (!name) {
    editError.value = "Label is required";
    return;
  }
  try {
    // Label identifies the account in the sidebar; display name is the
    // from-name recipients see on sent mail. They're deliberately separate
    // (e.g. label "Work", display name "John Doe <john@example.com>").
    await updateAccount({
      id: editAccount.value.id,
      patch: { name, displayName: editDisplayName.value.trim() || null },
    });
    editDialogOpen.value = false;
    editAccount.value = null;
  } catch (err) {
    editError.value = err instanceof Error ? err.message : "Failed to update account";
  }
}

function accountIndex(id: string): number {
  return (accounts.value ?? []).findIndex((a) => a.id === id);
}

function reorder(id: string, dir: -1 | 1) {
  const arr = accounts.value ?? [];
  const idx = arr.findIndex((a) => a.id === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= arr.length) return;
  const ordered = [...arr];
  [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
  // Persist the new order; the mutation optimistically reorders the list and
  // reverts on failure.
  reorderAccounts(ordered.map((a) => a.id));
}

// IMAP host suggestions (common providers) — the form itself starts empty.
const IMAP_HOSTS = [
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
  formMessage.value = null;
  try {
    const res = await api.testAccount({ provider: "imap", ...form.value });
    formMessage.value = res.ok
      ? { ok: true, message: t("accounts.connectionSuccess") }
      : { ok: false, message: res.message || t("accounts.connectionFailed") };
  } catch {
    formMessage.value = { ok: false, message: t("accounts.connectionFailed") };
  } finally {
    testing.value = false;
  }
}

async function addAccount() {
  adding.value = true;
  formMessage.value = null;
  try {
    await addAccountMutation({ provider: "imap", ...form.value });
    showAdd.value = false;
    form.value.password = "";
    // The new account's initial state is 'running' (a sync is enqueued
    // server-side); the add mutation invalidates account state so the poller
    // observes it and switches to the 1s cadence promptly.
  } catch (err) {
    formMessage.value = {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to add account",
    };
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
  await removeAccount(confirmDeleteId.value);
  confirmDeleteId.value = null;
  deleteDialogOpen.value = false;
}

function syncOne(id: string) {
  // Marks the account running optimistically (instant spinner + 1s poll) and
  // refreshes state/accounts/tree on settle. Sync failures surface via the
  // account's own state (state_message) once the poll applies it.
  syncAccount([id]);
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold">{{ t("accounts.emailAccounts") }}</h2>
      <UiButton variant="default" size="sm" @click="showAdd = !showAdd">
        <Plus class="h-4 w-4" /> {{ t("accounts.addAccount") }}
      </UiButton>
    </div>

    <!-- OAuth providers -->
    <div class="card-surface mb-4 grid gap-3 p-4 sm:grid-cols-2">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t("accounts.connectGmail") }}</div>
          <div v-if="meta?.config.gmailOauth" class="text-xs text-muted-foreground">
            {{ t("accounts.connectGmailHint") }}
          </div>
          <div v-else class="text-xs text-muted-foreground">
            {{ t("accounts.oauthNotConfigured", { name: "Google" }) }}
          </div>
        </div>
        <UiToolTip
          :label="
            meta?.config.gmailOauth
              ? t('accounts.connectGmailHint')
              : t('accounts.oauthNotConfigured', { name: 'Google' })
          "
        >
          <UiButton
            variant="outline"
            size="sm"
            :disabled="!meta?.config.gmailOauth"
            @click="connectOAuth('google')"
            >{{ t("accounts.connect") }}</UiButton
          >
        </UiToolTip>
      </div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t("accounts.connectOutlook") }}</div>
          <div v-if="meta?.config.outlookOauth" class="text-xs text-muted-foreground">
            {{ t("accounts.connectOutlookHint") }}
          </div>
          <div v-else class="text-xs text-muted-foreground">
            {{ t("accounts.oauthNotConfigured", { name: "Microsoft" }) }}
          </div>
        </div>
        <UiToolTip
          :label="
            meta?.config.outlookOauth
              ? t('accounts.connectOutlookHint')
              : t('accounts.oauthNotConfigured', { name: 'Microsoft' })
          "
        >
          <UiButton
            variant="outline"
            size="sm"
            :disabled="!meta?.config.outlookOauth"
            @click="connectOAuth('microsoft')"
            >{{ t("accounts.connect") }}</UiButton
          >
        </UiToolTip>
      </div>
    </div>

    <!-- IMAP / SMTP add form -->
    <div v-if="showAdd" class="card-surface mb-4 space-y-4 p-4">
      <div>
        <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t("accounts.imapSection") }}
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
            <label class="text-xs font-medium text-muted-foreground">{{
              t("accounts.label")
            }}</label>
            <UiInput v-model="form.name" class="w-full" placeholder="e.g. Work" />
            <p class="text-xs text-muted-foreground/70">{{ t("accounts.labelHint") }}</p>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">{{
              t("accounts.email")
            }}</label>
            <UiInput
              v-model="form.email"
              type="email"
              class="w-full"
              placeholder="you@example.com"
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">{{
              t("accounts.displayName")
            }}</label>
            <UiInput v-model="form.displayName" class="w-full" />
            <p class="text-xs text-muted-foreground/70">{{ t("accounts.displayNameHint") }}</p>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">{{
              t("accounts.username")
            }}</label>
            <UiInput v-model="form.username" class="w-full" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">{{
              t("accounts.password")
            }}</label>
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
                :aria-label="showPassword ? t('accounts.hidePassword') : t('accounts.showPassword')"
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
            <Inbox class="h-3.5 w-3.5" /> {{ t("accounts.imapGroup") }}
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="space-y-1 sm:col-span-2">
              <label class="text-xs font-medium text-muted-foreground">{{
                t("accounts.imapHost")
              }}</label>
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
              <label class="text-xs font-medium text-muted-foreground">{{
                t("accounts.port")
              }}</label>
              <UiInput v-model.number="form.imapPort" type="number" class="w-full" />
            </div>
            <div class="flex items-end gap-2 pb-1">
              <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{{
                t("accounts.secure")
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
            <Send class="h-3.5 w-3.5" /> {{ t("accounts.smtpGroup") }}
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="space-y-1 sm:col-span-2">
              <label class="text-xs font-medium text-muted-foreground">{{
                t("accounts.smtpHost")
              }}</label>
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
              <label class="text-xs font-medium text-muted-foreground">{{
                t("accounts.port")
              }}</label>
              <UiInput v-model.number="form.smtpPort" type="number" class="w-full" />
            </div>
            <div class="flex items-end gap-2 pb-1">
              <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{{
                t("accounts.secure")
              }}</label>
              <UiSwitch v-model="form.smtpSecure" />
            </div>
          </div>
        </div>

        <div
          v-if="formMessage"
          class="mt-3 flex items-center gap-1.5 text-xs"
          :class="formMessage.ok ? 'text-emerald-600' : 'text-destructive'"
        >
          <CheckCircle2 v-if="formMessage.ok" class="h-4 w-4" />
          <XCircle v-else class="h-4 w-4" />
          {{ formMessage.message }}
        </div>

        <div class="mt-3 flex gap-2">
          <UiButton variant="outline" size="sm" :disabled="testing" @click="testConnection">
            <Loader2 v-if="testing" class="h-4 w-4 animate-spin" />
            {{ testing ? t("accounts.testing") : t("accounts.testConnection") }}
          </UiButton>
          <UiButton variant="default" size="sm" :disabled="adding" @click="addAccount">
            <Loader2 v-if="adding" class="h-4 w-4 animate-spin" /> {{ t("accounts.addAccount") }}
          </UiButton>
          <UiButton variant="ghost" size="sm" @click="showAdd = false">{{
            t("common.cancel")
          }}</UiButton>
        </div>
      </div>
    </div>

    <!-- Account list: empty state (guides the user to add the first account) -->
    <div
      v-if="accounts.length === 0 && !showAdd"
      class="rounded-lg border border-dashed border-border p-8 text-center"
    >
      <p class="text-sm font-medium text-foreground/80">{{ t("mailbox.noAccountsTitle") }}</p>
      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
        {{ t("mailbox.noAccountsHint") }}
      </p>
      <UiButton variant="default" size="sm" class="mt-4" @click="showAdd = true">
        <Plus class="h-4 w-4" /> {{ t("accounts.addAccount") }}
      </UiButton>
    </div>
    <div v-for="a in accounts" :key="a.id" class="card-surface mb-2 flex items-center gap-3 p-3">
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
          <span v-if="a.state === 'healthy'" class="text-emerald-600">{{
            t("accounts.healthy")
          }}</span>
          <span
            v-else-if="a.state === 'running'"
            class="inline-flex items-center gap-1 text-sky-600"
          >
            <Loader2 class="h-3 w-3 animate-spin" /> {{ t("common.syncing") }}
          </span>
          <span v-else-if="a.state === 'unavailable'" class="text-amber-600">{{
            syncErrorLabel(a.stateMessage ?? "") || t("accounts.unavailable")
          }}</span>
          <span v-else-if="a.state === 'auth_required'" class="text-destructive">{{
            t("accounts.authRequired")
          }}</span>
          <span v-else>{{ a.state }}</span>
          <span v-if="a.lastSyncedAt" class="ml-2"
            >{{ t("accounts.syncedOn") }} {{ formatDate(a.lastSyncedAt) }}</span
          >
        </div>
      </div>
      <UiToolTip :label="a.state === 'running' ? t('common.syncing') : t('common.syncNow')">
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
        <UiToolTip :label="t('accounts.moveUp')">
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
        <UiToolTip :label="t('accounts.moveDown')">
          <UiButton
            variant="ghost"
            size="icon"
            class="h-6 w-6"
            :disabled="accountIndex(a.id) === accounts.length - 1"
            @click="reorder(a.id, 1)"
          >
            <ArrowDown class="h-3.5 w-3.5" />
          </UiButton>
        </UiToolTip>
      </div>
      <UiToolTip :label="t('accounts.editAccount')">
        <UiButton variant="ghost" size="icon" class="h-8 w-8" @click="openEdit(a)">
          <Pencil class="h-4 w-4" />
        </UiButton>
      </UiToolTip>
      <UiToolTip :label="t('accounts.removeAccount')">
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
      :title="t('accounts.confirmDeleteAccount')"
      :busy="deleting"
      @close="deleteDialogOpen = false"
    >
      <p class="text-sm text-muted-foreground">{{ t("accounts.confirmDeleteAccount") }}</p>
      <template #footer>
        <UiButton
          variant="ghost"
          size="sm"
          :disabled="deleting"
          @click="deleteDialogOpen = false"
          >{{ t("common.cancelAction") }}</UiButton
        >
        <UiButton variant="destructive" size="sm" :disabled="deleting" @click="confirmRemove">
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" /> {{ t("common.ok") }}
        </UiButton>
      </template>
    </UiDialog>

    <!-- Modal edit account (label + display name) -->
    <UiDialog
      :open="editDialogOpen"
      :title="t('accounts.editAccount')"
      :busy="savingEdit"
      @close="editDialogOpen = false"
    >
      <div class="space-y-3">
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground">{{ t("accounts.label") }}</label>
          <UiInput v-model="editName" class="w-full" maxlength="100" />
          <p class="text-xs text-muted-foreground/70">{{ t("accounts.labelHint") }}</p>
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground">{{
            t("accounts.displayName")
          }}</label>
          <UiInput v-model="editDisplayName" class="w-full" maxlength="100" />
          <p class="text-xs text-muted-foreground/70">{{ t("accounts.displayNameHint") }}</p>
        </div>
        <div v-if="editError" class="text-xs text-destructive">{{ editError }}</div>
      </div>
      <template #footer>
        <UiButton
          variant="ghost"
          size="sm"
          :disabled="savingEdit"
          @click="editDialogOpen = false"
          >{{ t("common.cancelAction") }}</UiButton
        >
        <UiButton variant="default" size="sm" :disabled="savingEdit" @click="saveEdit">
          <Loader2 v-if="savingEdit" class="h-4 w-4 animate-spin" /> {{ t("common.save") }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
