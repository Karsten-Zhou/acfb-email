// Vue Query client + shared cache-key definitions.
import { QueryClient } from "@tanstack/vue-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Server data is immutable until invalidated; re-fetching on focus or
      // mount adds noise. We invalidate explicitly after mutations/syncs.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const queryKeys = {
  accounts: ["accounts"] as const,
  accountStates: ["account-states"] as const,
  /** Full account → mailbox tree for the sidebar. */
  mailboxTree: ["mailbox-tree"] as const,
  /** Infinite message list for one mailbox. */
  messages: (mailboxId: string) => ["messages", mailboxId] as const,
  /** Infinite unified message list. */
  unified: ["unified"] as const,
  /** A single message detail. */
  message: (id: string, mailboxId?: string) => ["message", id, mailboxId ?? null] as const,
} as const;
