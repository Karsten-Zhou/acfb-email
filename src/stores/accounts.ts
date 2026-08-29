// Accounts data access via TanStack Query: connected accounts, mailboxes,
// the sidebar mailbox tree, and account mutations. Live sync state is a
// polled query (refetchInterval adapts to activity) — this replaces the old
// hand-rolled adaptive polling state machine (runInFlight / fastUntilHealthy /
// markAccountSyncing / clearAccountSyncing / kickAccountStatePoll). TanStack
// guarantees the poll timer never overlaps an in-flight fetch and cleans up on
// unmount, so the single-chain invariant is built in rather than hand-guarded.
import { computed } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { api } from "../lib/api";
import { queryClient, queryKeys } from "../lib/query";
import type { AccountState } from "@shared/constants";
import type { AccountSummary, AddAccountInput } from "@shared/types";

const RUNNING_POLL_MS = 1000;
const IDLE_POLL_MS = 60_000;

/** Lightweight per-account sync state as reported by /api/accounts/states. */
export interface AccountStateSummary {
  id: string;
  state: string;
  stateMessage: string | null;
  lastSyncedAt: string | null;
}

// ---- queries ----

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: async () => (await api.accounts()).accounts,
  });
}

/** Polled live sync state. Cadence adapts to activity: 1s while any account is
 *  running, 60s when idle. The interval derives from the server truth in the
 *  query data, so a fresh page load mid-sync still polls fast (no dependency
 *  on the accounts list being loaded yet). */
export function useAccountStates() {
  return useQuery({
    queryKey: queryKeys.accountStates,
    queryFn: async () => (await api.accountStates()).accounts as AccountStateSummary[],
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.state === "running") ? RUNNING_POLL_MS : IDLE_POLL_MS,
  });
}

/** Accounts merged with live sync state — the reactive list the sidebar and
 *  settings render, with spinners following `state === "running"`. */
export function useAccountSummaries() {
  const accounts = useAccounts();
  const states = useAccountStates();
  const statesById = computed(() => new Map((states.data.value ?? []).map((s) => [s.id, s])));
  const data = computed<AccountSummary[]>(() =>
    (accounts.data.value ?? []).map((a) => {
      const s = statesById.value.get(a.id);
      return s
        ? {
            ...a,
            state: s.state as AccountState,
            stateMessage: s.stateMessage,
            lastSyncedAt: s.lastSyncedAt,
          }
        : a;
    }),
  );
  return { ...accounts, data };
}

/** Flat account → mailbox tree for the sidebar, role-ordered. */
export function useMailboxTree() {
  return useQuery({
    queryKey: queryKeys.mailboxTree,
    queryFn: async () => {
      const { accounts } = await api.accounts();
      const nested = await Promise.all(
        accounts.map(async (a) => ({
          accountId: a.id,
          accountName: a.name,
          accountEmail: a.email,
          mailboxes: (await api.mailboxes(a.id)).mailboxes,
        })),
      );
      const order: Record<string, number> = {
        inbox: 0,
        all: 1,
        sent: 2,
        drafts: 3,
        archive: 4,
        spam: 5,
        trash: 6,
      };
      return nested.flatMap((a) =>
        a.mailboxes
          .slice()
          .sort((x, y) => (order[x.role] ?? 100) - (order[y.role] ?? 100))
          .map((mailbox) => ({
            accountId: a.accountId,
            accountName: a.accountName,
            accountEmail: a.accountEmail,
            mailbox,
          })),
      );
    },
  });
}

// ---- mutations ----

/** Optimistically flip the given accounts to "running" in the states cache so
 *  spinners appear instantly and the poller drops to the 1s cadence. The next
 *  poll (or the sync's onSettled invalidation) applies the server's truth. */
function setAccountsRunning(ids: string[]) {
  queryClient.setQueryData<AccountStateSummary[]>(queryKeys.accountStates, (prev) => {
    const arr = prev ?? [];
    const byId = new Map(arr.map((a) => [a.id, a]));
    for (const id of ids) {
      byId.set(id, {
        id,
        state: "running",
        stateMessage: null,
        lastSyncedAt: arr.find((a) => a.id === id)?.lastSyncedAt ?? null,
      });
    }
    return [...byId.values()];
  });
}

/** Sync one or more accounts. Marks them running optimistically; on settle,
 *  refreshes state, accounts, the mailbox tree, and message lists. */
export function useSyncAccounts() {
  const qc = queryClient;
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.all(
        ids.map((id) =>
          api.syncAccount(id).catch(() => ({ ok: false as const, message: undefined })),
        ),
      );
      return results;
    },
    onMutate: async (ids) => {
      // Cancel any in-flight /states poll so a stale (pre-sync) response can't
      // clobber the optimistic 'running' below — the documented TanStack
      // optimistic-update pattern.
      await qc.cancelQueries({ queryKey: queryKeys.accountStates });
      setAccountsRunning(ids);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.accountStates });
      qc.invalidateQueries({ queryKey: queryKeys.accounts });
      qc.invalidateQueries({ queryKey: queryKeys.mailboxTree });
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["unified"] });
    },
  });
}

/** Add a new IMAP account. */
export function useAddAccount() {
  const qc = queryClient;
  return useMutation({
    mutationFn: (input: AddAccountInput) => api.addAccount(input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.accountStates });
      qc.invalidateQueries({ queryKey: queryKeys.accounts });
      qc.invalidateQueries({ queryKey: queryKeys.mailboxTree });
    },
  });
}

/** Remove an account. Optimistically drops it from the list. */
export function useDeleteAccount() {
  const qc = queryClient;
  return useMutation({
    mutationFn: (id: string) => api.deleteAccount(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.accounts });
      const prev = qc.getQueryData<AccountSummary[]>(queryKeys.accounts);
      qc.setQueryData<AccountSummary[]>(
        queryKeys.accounts,
        (old) => old?.filter((a) => a.id !== id) ?? [],
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.accounts, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.accounts });
      qc.invalidateQueries({ queryKey: queryKeys.mailboxTree });
    },
  });
}

/** Rename / update an account's display fields. */
export function useUpdateAccount() {
  const qc = queryClient;
  return useMutation({
    mutationFn: (vars: {
      id: string;
      patch: {
        name?: string;
        displayName?: string | null;
        syncEnabled?: boolean;
        sortOrder?: number;
      };
    }) => api.updateAccount(vars.id, vars.patch),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.accounts });
      qc.invalidateQueries({ queryKey: queryKeys.mailboxTree });
    },
  });
}

/** Persist a new account order. Optimistically reorders the list; reverts on error. */
export function useReorderAccounts() {
  const qc = queryClient;
  return useMutation({
    mutationFn: (orderedIds: string[]) => api.reorderAccounts(orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: queryKeys.accounts });
      const prev = qc.getQueryData<AccountSummary[]>(queryKeys.accounts);
      qc.setQueryData<AccountSummary[]>(queryKeys.accounts, (old) => {
        const byId = new Map((old ?? []).map((a) => [a.id, a]));
        return orderedIds.map((id) => byId.get(id)).filter((a): a is AccountSummary => !!a);
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.accounts, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}
