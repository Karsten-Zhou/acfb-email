// Accounts store: connected email accounts + mailboxes (reactive singleton).
import { reactive } from "vue";
import { api } from "../lib/api";
import type { AccountState } from "@shared/constants";
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

// ---------------------------------------------------------------------------
// Live account-state polling.
//
// Sync runs server-side in the background (waitUntil), so the client can't
// know when an account leaves `running` without asking. We poll a lightweight
// endpoint and merge the result into the reactive list — the sidebar and
// settings spinners follow `state === 'running'` automatically, for ANY sync
// origin (auto-sync after add/reconnect, manual Sync-now, pull-to-refresh).
// ---------------------------------------------------------------------------
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 3000;

/** Merge fresh server state into the reactive account list (preserves order). */
async function pollAccountStates() {
  try {
    const { accounts } = await api.accountStates();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const acc of accountsState.accounts) {
      const fresh = byId.get(acc.id);
      if (!fresh) continue;
      acc.state = fresh.state as AccountState;
      acc.stateMessage = fresh.stateMessage;
      acc.lastSyncedAt = fresh.lastSyncedAt;
    }
  } catch {
    /* transient — next tick retries */
  }
}

/** Start polling account states (idempotent). Call from top-level layouts. */
export function startAccountStatePolling() {
  if (pollTimer) return;
  void pollAccountStates();
  pollTimer = setInterval(pollAccountStates, POLL_MS);
}

/** Stop polling (e.g. on logout / route teardown). */
export function stopAccountStatePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
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
