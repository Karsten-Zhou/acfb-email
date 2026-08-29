// Message selection + bulk actions (move/delete/read/star). Domain logic shared
// by any message list context — the data it operates on is injected so it isn't
// tied to a specific view. Selection state is pure UI; mutations come from the
// mail store and handle optimistic updates + invalidation.
import { computed, ref } from "vue";
import type { Router, RouteLocationNormalizedLoaded } from "vue-router";
import { useUpdateFlags, useMoveMessages, useDeleteMessages } from "../stores/mail";
import { toastError, toastSuccess } from "../stores/toast";
import { t } from "../lib/i18n";
import type { Mailbox, Message, MessageDetail } from "@shared/types";

export interface MailboxTreeItem {
  accountId: string;
  mailbox: Mailbox;
}

interface UseMessageActionsOptions {
  /** All messages currently loaded in the active list. */
  getMessages: () => Message[];
  /** The account → mailbox tree (used to build the move-to-folder list). */
  getMailboxTree: () => MailboxTreeItem[];
  /** The currently open message detail (null = none). */
  getSelected: () => MessageDetail | null;
  route: RouteLocationNormalizedLoaded;
  router: Router;
}

export function useMessageActions({
  getMessages,
  getMailboxTree,
  getSelected,
  route,
  router,
}: UseMessageActionsOptions) {
  const { mutate: updateFlags } = useUpdateFlags();
  const { mutateAsync: moveMessages, isPending: moving } = useMoveMessages();
  const { mutateAsync: deleteMessages, isPending: deleting } = useDeleteMessages();

  /** Bulk-selection state (pure UI). */
  const selectedIds = ref<Set<string>>(new Set());
  const selectedCount = computed(() => selectedIds.value.size);
  /** If set, the confirm dialog targets a single message (from the reading pane). */
  const pendingDeleteId = ref<string | null>(null);
  const confirmDelete = ref(false);
  /** Move-to-folder dialog: open state + the ids to move when a folder is picked. */
  const confirmMove = ref(false);
  const pendingMoveIds = ref<string[]>([]);
  /** The account whose mailboxes the move dialog lists (moves stay in-account). */
  const moveAccountId = ref<string | null>(null);
  /** Read-toggle in flight: spinner shows on the reader's mark-read button. */
  const togglingRead = ref(false);
  /** Star-toggle in flight: spinner shows on the reader's star button. */
  const togglingStar = ref(false);

  function toggleSelect(id: string) {
    const set = new Set(selectedIds.value);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    selectedIds.value = set;
  }

  function clearSelection() {
    selectedIds.value = new Set();
  }

  function markSelectedRead() {
    updateFlags({ ids: [...selectedIds.value], flags: { read: true } });
    clearSelection();
  }

  /** Open the confirm dialog for the bulk selection. */
  function confirmDeleteSelected() {
    pendingDeleteId.value = null;
    confirmDelete.value = true;
  }

  /** Confirm dialog for a single message (from the reading pane). */
  function confirmDeleteOne(id: string) {
    pendingDeleteId.value = id;
    confirmDelete.value = true;
  }

  async function doDeleteSelected() {
    const ids = pendingDeleteId.value ? [pendingDeleteId.value] : [...selectedIds.value];
    await deleteMessages(ids);
    if (pendingDeleteId.value) {
      pendingDeleteId.value = null;
      if (route.params.id) await router.replace("/mail");
    } else {
      clearSelection();
    }
    confirmDelete.value = false;
  }

  /** Mailboxes the move dialog offers (same account, minus the pending
   *  messages' own folders). */
  const moveExcludedMailboxIds = computed(() => {
    const ids = new Set<string>();
    for (const m of getMessages()) {
      if (pendingMoveIds.value.includes(m.id)) ids.add(m.mailboxId);
    }
    const sel = getSelected();
    if (sel && pendingMoveIds.value.includes(sel.id)) ids.add(sel.mailboxId);
    return ids;
  });

  const moveTargetMailboxes = computed(() =>
    getMailboxTree().filter(
      (item) =>
        item.accountId === moveAccountId.value &&
        !moveExcludedMailboxIds.value.has(item.mailbox.id),
    ),
  );

  /** Open the move dialog for the bulk selection (all messages must share one
   *  account). */
  function openMoveSelected() {
    const ids = [...selectedIds.value];
    const msgs = getMessages().filter((m) => ids.includes(m.id));
    const accounts = new Set(msgs.map((m) => m.accountId));
    if (accounts.size !== 1) {
      toastError(t("message.moveMixedAccounts"));
      return;
    }
    pendingMoveIds.value = ids;
    moveAccountId.value = [...accounts][0];
    confirmMove.value = true;
  }

  /** Open the move dialog for a single message (from the reading pane). */
  function openMoveMessage(id: string) {
    const m = getSelected();
    if (!m) return;
    pendingMoveIds.value = [id];
    moveAccountId.value = m.accountId;
    confirmMove.value = true;
  }

  /** Move the pending messages into the picked mailbox. */
  async function doMove(targetMailboxId: string) {
    if (moving.value || pendingMoveIds.value.length === 0) return;
    await moveMessages({ ids: pendingMoveIds.value, targetMailboxId });
    toastSuccess(t("message.movedMessages"));
    // If the open reading message was moved, close the reader.
    const sel = getSelected();
    if (sel && pendingMoveIds.value.includes(sel.id)) {
      if (route.params.id) await router.replace("/mail");
    }
    clearSelection();
    confirmMove.value = false;
  }

  /**
   * Toggle read/unread from the reader. When marking a message *unread*, on
   * success deselect it (close the reader) so it disappears from the read view
   * and stays visible in the unread filter. Shows a loading state while the
   * flag update is in flight.
   */
  async function toggleReadFromReader() {
    const m = getSelected();
    if (!m) return;
    togglingRead.value = true;
    try {
      // Toggle: the new desired read flag.
      const newRead = !m.isRead;
      await updateFlags({ ids: [m.id], flags: { read: newRead } });
      // If the message *became unread*, close the reader so the changed entry
      // is only visible in the list (bolded, unread count bumped). If it became
      // read, keep it open as usual.
      if (!newRead) {
        // Navigate FIRST so the route watch clears the selection cleanly and
        // never re-opens the (now unread) message with a stale id — that would
        // re-run the auto-read and mark it read again.
        if (route.params.id) await router.replace("/mail");
      }
    } finally {
      togglingRead.value = false;
    }
  }

  /** Toggle star/unstar on the open reading message. Shows a spinner on the
   *  reader's star button (and in the compact "…" menu) while in flight. */
  async function toggleStar() {
    const m = getSelected();
    if (!m) return;
    togglingStar.value = true;
    try {
      await updateFlags({ ids: [m.id], flags: { starred: !m.isStarred } });
    } finally {
      togglingStar.value = false;
    }
  }

  return {
    selectedIds,
    selectedCount,
    pendingDeleteId,
    pendingMoveIds,
    moveAccountId,
    confirmDelete,
    confirmMove,
    togglingRead,
    togglingStar,
    moving,
    deleting,
    moveTargetMailboxes,
    toggleSelect,
    clearSelection,
    markSelectedRead,
    confirmDeleteSelected,
    confirmDeleteOne,
    doDeleteSelected,
    openMoveSelected,
    openMoveMessage,
    doMove,
    toggleReadFromReader,
    toggleStar,
  };
}
