<script setup lang="ts">
// AccountSettings — the "Email accounts" section of Settings. Owns the shared
// section header + add-account toggle, then composes self-contained parts:
// AddAccountForm (OAuth connect + IMAP/SMTP add form), AccountListSection
// (account list + delete dialog), and EditAccountDialog. Edit-dialog logic
// lives in useEditAccount here so the list's "edit" clicks and the dialog's
// save share one state.
import { ref } from "vue";
import { useEditAccount } from "../../composables/useEditAccount";
import type { HealthPayload } from "../../lib/api";
import { t } from "../../lib/i18n";
import UiButton from "../../components/UiButton.vue";
import AddAccountForm from "./AddAccountForm.vue";
import AccountListSection from "./AccountListSection.vue";
import EditAccountDialog from "./EditAccountDialog.vue";
import { Plus } from "@lucide/vue";

defineProps<{
  meta: HealthPayload | null;
}>();

const showAdd = ref(false);
const { editDialogOpen, editName, editDisplayName, editError, savingEdit, openEdit, saveEdit } =
  useEditAccount();
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold">{{ t("accounts.emailAccounts") }}</h2>
      <UiButton variant="default" size="sm" @click="showAdd = !showAdd">
        <Plus class="h-4 w-4" /> {{ t("accounts.addAccount") }}
      </UiButton>
    </div>

    <AddAccountForm :meta="meta" :open="showAdd" @close="showAdd = false" />

    <AccountListSection :show-add="showAdd" @edit="openEdit" @add="showAdd = true" />

    <EditAccountDialog
      :open="editDialogOpen"
      :name="editName"
      :display-name="editDisplayName"
      :error="editError"
      :busy="savingEdit"
      @update:name="editName = $event"
      @update:display-name="editDisplayName = $event"
      @save="saveEdit"
      @close="editDialogOpen = false"
    />
  </div>
</template>
