<script setup lang="ts">
// AddAccountForm — the OAuth connect cards + IMAP/SMTP add form. Form state
// and handlers come from useAddAccountForm; this file only binds them to the
// UI. Visibility is driven by the `open` prop (the parent's "add account"
// button).
import { useAddAccountForm } from "../../composables/useAddAccountForm";
import type { HealthPayload } from "@shared/api";
import { t } from "../../lib/i18n";
import UiButton from "../../components/UiButton.vue";
import UiInput from "../../components/UiInput.vue";
import UiSwitch from "../../components/UiSwitch.vue";
import UiToolTip from "../../components/UiToolTip.vue";
import { Loader2, CheckCircle2, XCircle, Search, Eye, EyeOff, Inbox, Send } from "@lucide/vue";

defineProps<{
  meta: HealthPayload | null;
  open: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const {
  IMAP_HOSTS,
  adding,
  testing,
  formMessage,
  form,
  showPassword,
  focusedHost,
  applyPreset,
  hostOptions,
  showOptions,
  connectOAuth,
  testConnection,
  addAccount,
} = useAddAccountForm();

/** Close the form after a successful add (errors stay open to show the message). */
async function onSubmitAdd() {
  if (await addAccount()) emit("close");
}
</script>

<template>
  <div>
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
    <div v-if="open" class="card-surface mb-4 space-y-4 p-4">
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
          <UiButton variant="default" size="sm" :disabled="adding" @click="onSubmitAdd">
            <Loader2 v-if="adding" class="h-4 w-4 animate-spin" /> {{ t("accounts.addAccount") }}
          </UiButton>
          <UiButton variant="ghost" size="sm" @click="emit('close')">{{
            t("common.cancel")
          }}</UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
