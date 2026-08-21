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

export async function syncAccount(accountId: string) {
  return api.syncAccount(accountId);
}