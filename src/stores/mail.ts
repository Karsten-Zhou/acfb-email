// Mail data access via TanStack Query: message lists (infinite), message
// detail, and mutations (flags / move / delete) with optimistic updates and
// cache invalidation. Replaces the old imperative reactive singleton — server
// state is keyed by mailbox, deduped, and auto-refreshed on invalidation.
import { computed, toRef } from "vue";
import type { MaybeRef, Ref } from "vue";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/vue-query";
import type { InfiniteData } from "@tanstack/vue-query";
import { api } from "../lib/api";
import { queryClient, queryKeys } from "../lib/query";
import type { Message, MessageDetail } from "@shared/types";

const PAGE_SIZE = 50;

interface Page {
  messages: Message[];
  hasMore?: boolean;
}

/** One mailbox's message list as an infinite (offset + beforeUid) pager. */
export function useMessages(mailboxId: MaybeRef<string>) {
  const id = toRef(mailboxId);
  return useInfiniteQuery({
    queryKey: computed(() => queryKeys.messages(id.value)),
    queryFn: async ({ pageParam }) => {
      const { messages, hasMore } = await api.messages(
        id.value,
        PAGE_SIZE,
        pageParam.offset,
        pageParam.beforeUid,
      );
      return { messages, hasMore };
    },
    initialPageParam: { offset: 0, beforeUid: undefined as number | undefined },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      const offset = allPages.reduce((n, p) => n + p.messages.length, 0);
      const uids = allPages
        .flatMap((p) => p.messages)
        .map((m) => m.remoteUid)
        .filter((x): x is number => !!x);
      return { offset, beforeUid: uids.length ? Math.min(...uids) : undefined };
    },
    enabled: computed(() => !!id.value && id.value !== "unified"),
  });
}

/** Unified inbox (all accounts) as an offset pager. */
export function useUnified() {
  return useInfiniteQuery({
    queryKey: queryKeys.unified,
    queryFn: async ({ pageParam }) => {
      const { messages, hasMore } = await api.unified(PAGE_SIZE, pageParam.offset);
      return { messages, hasMore };
    },
    initialPageParam: { offset: 0 },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore
        ? { offset: allPages.reduce((n, p) => n + p.messages.length, 0) }
        : undefined,
  });
}

/** Flatten an infinite message query's pages into a single array. */
export function flattenMessages(query: { data: Ref<InfiniteData<Page> | undefined> }): Message[] {
  return query.data.value?.pages?.flatMap((p) => p.messages) ?? [];
}

/** A single message's full detail (body + attachments + flags). */
export function useMessage(
  id: MaybeRef<string | undefined>,
  mailboxId?: MaybeRef<string | undefined>,
) {
  const messageId = toRef(id);
  const boxId = mailboxId ? toRef(mailboxId) : undefined;
  return useQuery({
    queryKey: computed(() => queryKeys.message(messageId.value ?? "", boxId?.value)),
    queryFn: async () => (await api.message(messageId.value!, boxId?.value)).message,
    enabled: computed(() => !!messageId.value),
  });
}

/** Apply a flags patch to every cached message list + detail for the ids. */
function updateMessageFlagsInCaches(ids: string[], flags: { read?: boolean; starred?: boolean }) {
  const idSet = new Set(ids);
  const patch = <T extends { id: string; isRead: boolean; isStarred: boolean }>(m: T): T =>
    idSet.has(m.id)
      ? { ...m, isRead: flags.read ?? m.isRead, isStarred: flags.starred ?? m.isStarred }
      : m;
  const patchPage = (data?: InfiniteData<Page>) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((p) => ({ ...p, messages: p.messages.map(patch) })),
    };
  };
  queryClient.setQueriesData<InfiniteData<Page>>({ queryKey: ["messages"] }, patchPage);
  queryClient.setQueriesData<InfiniteData<Page>>({ queryKey: ["unified"] }, patchPage);
  queryClient.setQueriesData<MessageDetail>({ queryKey: ["message"] }, (old) =>
    old ? patch(old) : old,
  );
}

/** Toggle read / starred flags. Optimistically updates caches; invalidates on error. */
export function useUpdateFlags() {
  const qc = queryClient;
  return useMutation({
    mutationFn: (vars: { ids: string[]; flags: { read?: boolean; starred?: boolean } }) =>
      api.flags(vars.ids, vars.flags),
    onMutate: (vars) => updateMessageFlagsInCaches(vars.ids, vars.flags),
    onError: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["unified"] });
      qc.invalidateQueries({ queryKey: ["message"] });
    },
  });
}

/** Move messages to another mailbox. Invalidates the affected caches. */
export function useMoveMessages() {
  const qc = queryClient;
  return useMutation({
    mutationFn: (vars: { ids: string[]; targetMailboxId: string }) =>
      api.move(vars.ids, vars.targetMailboxId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["unified"] });
      qc.invalidateQueries({ queryKey: ["mailbox-tree"] });
    },
  });
}

/** Delete messages. Invalidates the affected caches. */
export function useDeleteMessages() {
  const qc = queryClient;
  return useMutation({
    mutationFn: (ids: string[]) => api.delete(ids),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["unified"] });
      qc.invalidateQueries({ queryKey: ["mailbox-tree"] });
    },
  });
}
