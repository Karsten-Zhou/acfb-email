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
// Adaptive live account-state polling.
//
// Sync runs server-side in the background (waitUntil), so the client can't
// know when an account leaves `running` without asking. We poll a lightweight
// endpoint and merge the result into the reactive list — the sidebar and
// settings spinners follow `state === 'running'` automatically, for ANY sync
// origin (auto-sync after add/reconnect, manual Sync-now, pull-to-refresh).
//
// The interval adapts to activity: 1s while a sync is in flight (so the
// sidebar/settings flip to healthy the moment it finishes), 60s when idle
// (cheap background freshness for e.g. new accounts after reconnect). Each
// poll schedules the next only after it completes, so requests never overlap.
// ---------------------------------------------------------------------------
const RUNNING_POLL_MS = 1000;
const IDLE_POLL_MS = 60_000;

let active = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/** Fetch + merge server state; returns true if any account is still syncing. */
async function pollAccountStates(): Promise<boolean> {
  try {
    const { accounts } = await api.accountStates();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    let anyRunning = false;
    for (const acc of accountsState.accounts) {
      const fresh = byId.get(acc.id);
      if (!fresh) continue;
      acc.state = fresh.state as AccountState;
      acc.stateMessage = fresh.stateMessage;
      acc.lastSyncedAt = fresh.lastSyncedAt;
      if (fresh.state === "running") anyRunning = true;
    }
    return anyRunning;
  } catch {
    // Transient failure — keep polling at the idle cadence and retry.
    return false;
  }
}

function scheduleNext(delay: number) {
  if (!active) return;
  pollTimer = setTimeout(run, delay);
}

async function run() {
  pollTimer = null;
  if (!active) return;
  const anyRunning = await pollAccountStates();
  if (!active) return; // stopped while awaiting
  scheduleNext(anyRunning ? RUNNING_POLL_MS : IDLE_POLL_MS);
}

/** Start adaptive state polling (idempotent). Call from top-level layouts. */
export function startAccountStatePolling() {
  if (active) return;
  active = true;
  void run(); // immediate first poll, then adapts its cadence
}

/** Stop polling (e.g. on logout / route teardown). */
export function stopAccountStatePolling() {
  active = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
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
