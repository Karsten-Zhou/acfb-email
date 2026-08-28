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
// The interval adapts to activity: 1s while a sync is in flight, 60s when
// idle. Each poll schedules the next only after it completes, so requests
// never overlap. Crucially, starting a sync locally calls `markAccountSyncing`
// which (a) sets the account's state to 'running' immediately (instant UI
// feedback — no waiting for a poll) and (b) forces the loop into fast 1s
// mode right away, so the settled state shows up promptly.
// ---------------------------------------------------------------------------
const RUNNING_POLL_MS = 1000;
const IDLE_POLL_MS = 60_000;

let active = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
/** True while a poll request is in flight (reentrancy guard for run()). */
let runInFlight = false;
// While armed, poll at 1s even if a single /states response happens to arrive
// before the server has set 'running' (a poll racing the sync's state write
// would otherwise see idle and drop to 60s, missing the whole sync).
let fastUntilHealthy = false;

/** Fetch + merge server state; returns true if any account is still syncing. */
async function pollAccountStates(): Promise<boolean> {
  try {
    const { accounts } = await api.accountStates();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    // Fast mode follows the SERVER truth, not the local list: on a fresh page
    // load the accounts list may not be populated yet when the first poll
    // runs, so an account still 'running' server-side must keep the loop at
    // 1s regardless (otherwise entering the page mid-sync shows a stale
    // spinner until the next idle poll — up to a minute later).
    let anyRunning = accounts.some((a) => a.state === "running");
    for (const acc of accountsState.accounts) {
      const fresh = byId.get(acc.id);
      if (!fresh) continue;
      // While fast mode is armed we may have optimistically set 'running' (in
      // markAccountSyncing) before the server has flipped it. Don't let a
      // premature 'healthy' response clobber it — keep showing the spinner
      // until the server truth reports running (or the sync request resolves).
      if (fastUntilHealthy && acc.state === "running" && fresh.state !== "running") {
        anyRunning = true;
        continue;
      }
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
  // Reentrancy guard: markAccountSyncing / clearAccountSyncing / sync-all can
  // call run() while a poll is already awaiting its fetch (e.g. sync-all marks
  // one account per iteration). Without this, two overlapping run() calls both
  // scheduleNext() on completion → two independent poll chains poll forever.
  if (!active || runInFlight) return;
  runInFlight = true;
  pollTimer = null;
  try {
    const anyRunning = await pollAccountStates();
    if (!active) return; // stopped while awaiting
    // Stay fast while a sync is observed OR we've been told one is starting
    // (server may not have flipped 'running' yet when this poll raced it).
    const fast = anyRunning || fastUntilHealthy;
    if (!anyRunning) fastUntilHealthy = false; // settled → disarm
    scheduleNext(fast ? RUNNING_POLL_MS : IDLE_POLL_MS);
  } finally {
    runInFlight = false;
  }
}

/** Start adaptive state polling (idempotent). Call from main.ts on boot. */
export function startAccountStatePolling() {
  if (active) return;
  active = true;
  void run();
}

/** Stop polling (e.g. on logout / route teardown). */
export function stopAccountStatePolling() {
  active = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/**
 * Optimistically mark an account as syncing and switch the poller to fast
 * (1s) mode immediately. Call right after starting a sync from the UI so the
 * spinner/"Syncing…" label appears instantly instead of waiting for the next
 * poll, and the settled result is picked up without the 60s idle gap.
 */
export function markAccountSyncing(accountId: string) {
  const acc = accountsState.accounts.find((a) => a.id === accountId);
  if (acc) {
    acc.state = "running";
    acc.stateMessage = null;
  }
  fastUntilHealthy = true;
  // Cancel any pending idle wait and poll right now; the loop now holds the
  // 1s cadence until a poll observes the settled (non-running) state.
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (active) void run();
  else startAccountStatePolling();
}

/**
 * Called when the sync request the UI started has finished (success or
 * failure). The server has settled the account state by now, so disarm fast
 * mode and let the next poll apply the server's truth (healthy/unavailable)
 * instead of keeping the optimistic 'running' forever.
 */
export function clearAccountSyncing() {
  fastUntilHealthy = false;
  // Poll immediately; the next poll applies the server's settled state.
  if (active) {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    void run();
  }
}

/**
 * Kick the adaptive poller to poll right now without arming the optimistic
 * 'running' override. Use right after adding/connecting an account: the server
 * already reports the new account as 'running' (a sync is enqueued), so a
 * single immediate poll observes it and switches the loop to the 1s cadence
 * until the sync settles. markAccountSyncing is NOT suitable here — its
 * fastUntilHealthy override has no matching clearAccountSyncing for the
 * queue-driven sync, so it would keep showing 'running' forever once armed.
 */
export function kickAccountStatePoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (active) void run();
  else startAccountStatePolling();
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
