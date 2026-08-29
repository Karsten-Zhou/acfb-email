// Sync orchestration for a mailbox view: "sync all", per-account sync, and
// pull-to-refresh, plus the post-sync refresh of the tree/accounts/message
// list. The data it needs (account ids + the active list refetch) is injected,
// so it works from any mailbox context.
import { ref } from "vue";
import { useSyncAccounts } from "../stores/accounts";
import { queryClient, queryKeys } from "../lib/query";
import { syncErrorLabel } from "../lib/i18n";
import { toastError } from "../stores/toast";

interface UseMailboxSyncOptions {
  /** All account ids to sync when "sync all" is triggered. */
  getAccountIds: () => string[];
  /** Refetch the currently active message list (post-sync refresh). */
  refetchMessages: () => Promise<unknown>;
}

export function useMailboxSync({ getAccountIds, refetchMessages }: UseMailboxSyncOptions) {
  const { mutateAsync: syncAccounts, isPending: syncing } = useSyncAccounts();
  /** Last sync failure shown in the list-pane banner (null = none). */
  const syncError = ref<string | null>(null);
  /** Pull-to-refresh in flight (mobile touch drag). */
  const refreshing = ref(false);

  /** Refresh the mailbox tree + accounts (used after a manual sync). */
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mailboxTree }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
    ]);
    await refetchMessages();
  }

  async function syncNow() {
    syncError.value = null;
    // Marks every account running optimistically (instant spinners, 1s poll) and
    // invalidates state/accounts/tree/messages on settle so the server's truth
    // and any new mail show up.
    const results = await syncAccounts(getAccountIds());
    const failed = results.find((r) => !r.ok);
    if (failed && failed.message) {
      const msg = syncErrorLabel(failed.message);
      syncError.value = msg;
      toastError(msg);
    }
    await refresh();
  }

  /** Pull-to-refresh: same sync as the toolbar button, with the list spinner. */
  async function pullRefresh() {
    refreshing.value = true;
    try {
      await syncNow();
    } finally {
      refreshing.value = false;
    }
  }

  async function syncAccountNow(id: string) {
    syncError.value = null;
    const [result] = await syncAccounts([id]);
    if (result && !result.ok && result.message) {
      const msg = syncErrorLabel(result.message);
      syncError.value = msg;
      toastError(msg);
    }
    await refresh();
  }

  return { syncing, syncError, refreshing, refresh, syncNow, pullRefresh, syncAccountNow };
}
