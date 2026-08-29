<script setup lang="ts">
// AccountListSection — the connected-account list: empty state, rows with
// sync/reorder/edit/remove, and the delete-confirmation dialog. List logic
// (ordering, sync, delete) lives in useAccountList. Editing a row is emitted
// up so the parent owns the edit dialog; the empty-state "add" button is also
// emitted up so the parent toggles the add form.
import { useAccountList } from "../../composables/useAccountList";
import { t, formatDate, syncErrorLabel } from "../../lib/i18n";
import UiButton from "../../components/UiButton.vue";
import UiDialog from "../../components/UiDialog.vue";
import UiToolTip from "../../components/UiToolTip.vue";
import { Plus, RefreshCw, Trash2, Loader2, ArrowUp, ArrowDown, Pencil } from "@lucide/vue";
import type { AccountSummary } from "@shared/types";

defineProps<{
  /** When true the add form is open, so the empty-state CTA hides. */
  showAdd: boolean;
}>();

const emit = defineEmits<{ edit: [a: AccountSummary]; add: [] }>();

const {
  accounts,
  deleting,
  deleteDialogOpen,
  accountIndex,
  reorder,
  askRemoveAccount,
  confirmRemove,
  syncOne,
} = useAccountList();
</script>

<template>
  <div>
    <!-- Account list: empty state (guides the user to add the first account) -->
    <div
      v-if="accounts.length === 0 && !showAdd"
      class="rounded-lg border border-dashed border-border p-8 text-center"
    >
      <p class="text-sm font-medium text-foreground/80">{{ t("mailbox.noAccountsTitle") }}</p>
      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
        {{ t("mailbox.noAccountsHint") }}
      </p>
      <UiButton variant="default" size="sm" class="mt-4" @click="emit('add')">
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
        <UiButton variant="ghost" size="icon" class="h-8 w-8" @click="emit('edit', a)">
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
  </div>
</template>
