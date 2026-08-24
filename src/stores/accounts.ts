// Accounts store: connected email accounts + mailboxes (reactive singleton).
import { reactive } from "vue";
import { api } from "../lib/api";
import type { AccountSummary, Mailbox } from "@shared/types";

interface AccountsState {
  accounts: AccountSummary[];
  mailboxes: Mailbox[];
  loading: boolean;
  error: string | null;
}

export const accountsState = reactive<AccountsState>({
  accounts: [],
  mailboxes: [],
  loading: false,
  error: null,
});

export async function loadAccounts() {
  accountsState.loading = true;
  accountsState.error = null;
  try {
    const { accounts } = await api.accounts();
    accountsState.accounts = accounts;
  } catch (err) {
    accountsState.error = err instanceof Error ? err.message : "Failed to load accounts";
  } finally {
    accountsState.loading = false;
  }
}

export async function loadMailboxes(accountId: string) {
  const { mailboxes } = await api.mailboxes(accountId);
  accountsState.mailboxes = mailboxes;
}

export async function removeAccount(accountId: string) {
  await api.deleteAccount(accountId);
  accountsState.accounts = accountsState.accounts.filter((a) => a.id !== accountId);
}

export async function updateAccount(
  accountId: string,
  patch: {
    name?: string;
    displayName?: string | null;
    syncEnabled?: boolean;
    sortOrder?: number;
  },
) {
  await api.updateAccount(accountId, patch);
  // Apply locally (preserve order).
  accountsState.accounts = accountsState.accounts.map((a) =>
    a.id === accountId
      ? {
          ...a,
          name: patch.name ?? a.name,
          displayName:
            patch.displayName !== undefined && patch.displayName !== null
              ? patch.displayName
              : patch.displayName === null
                ? null
                : a.displayName,
        }
      : a,
  );
}

/** Swap two accounts in the list and persist the new order. */
export async function moveAccount(accountId: string, direction: -1 | 1) {
  const arr = [...accountsState.accounts];
  const idx = arr.findIndex((a) => a.id === accountId);
  if (idx < 0) return;
  const target = idx + direction;
  if (target < 0 || target >= arr.length) return;
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  accountsState.accounts = arr;
  try {
    await api.reorderAccounts(arr.map((a) => a.id));
  } catch {
    // Revert on failure.
    await loadAccounts();
  }
}

export async function syncAccount(accountId: string) {
  return api.syncAccount(accountId);
}
