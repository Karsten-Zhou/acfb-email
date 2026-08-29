// Account list logic: the merged account summaries, user-controlled ordering,
// per-account sync, and the delete-confirmation dialog. Reusable by any place
// that lists/manages connected accounts.
import { ref } from "vue";
import {
  useAccountSummaries,
  useDeleteAccount,
  useReorderAccounts,
  useSyncAccounts,
} from "../stores/accounts";

export function useAccountList() {
  const { data: accounts } = useAccountSummaries();
  const { mutateAsync: removeAccount, isPending: deleting } = useDeleteAccount();
  const { mutate: reorderAccounts } = useReorderAccounts();
  const { mutate: syncAccount } = useSyncAccounts();

  const confirmDeleteId = ref<string | null>(null);
  /** Whether the confirm dialog is open (so the row can be deleted via modal). */
  const deleteDialogOpen = ref(false);

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

  return {
    accounts,
    deleting,
    confirmDeleteId,
    deleteDialogOpen,
    accountIndex,
    reorder,
    askRemoveAccount,
    confirmRemove,
    syncOne,
  };
}
