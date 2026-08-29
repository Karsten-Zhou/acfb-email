// "Edit account" dialog logic: rename the label + display name. The dialog's
// open/field/error state and the save handler live here so the UI stays thin.
import { ref } from "vue";
import { useUpdateAccount } from "../stores/accounts";

export interface EditableAccount {
  id: string;
  name: string;
  displayName: string | null;
}

export function useEditAccount() {
  /** The account being edited (null = dialog closed). */
  const editAccount = ref<EditableAccount | null>(null);
  const editDialogOpen = ref(false);
  const editName = ref("");
  const editDisplayName = ref("");
  const editError = ref<string | null>(null);
  const { mutateAsync: updateAccount, isPending: savingEdit } = useUpdateAccount();

  function openEdit(a: EditableAccount) {
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

  return {
    editAccount,
    editDialogOpen,
    editName,
    editDisplayName,
    editError,
    savingEdit,
    openEdit,
    saveEdit,
  };
}
