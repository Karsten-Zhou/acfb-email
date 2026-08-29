// Compose form: the send/draft fields, recipient parsing, and the send /
// save-draft / discard actions. Owns no presentation — the rich-text editor
// and attachments are injected so the composable stays reusable across compose
// UIs (new message, reply, edit draft).
import { computed, ref, watch } from "vue";
import type { Router, RouteLocationNormalizedLoaded } from "vue-router";
import { useAccounts, useSyncAccounts } from "../stores/accounts";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { toastSuccess } from "../stores/toast";
import type { ComposeAttachment } from "./useComposeAttachments";

export interface ComposeEditor {
  getText: () => string;
}

interface UseComposeFormOptions {
  route: RouteLocationNormalizedLoaded;
  router: Router;
  /** The rich-text editor, exposing getText() for the text/plain MIME part. */
  editorRef: { value: ComposeEditor | null };
  /** Files attached to the outgoing message (read client-side). */
  attachments: { value: ComposeAttachment[] };
}

export function useComposeForm({ route, router, editorRef, attachments }: UseComposeFormOptions) {
  const accountId = ref("");
  const to = ref("");
  const cc = ref("");
  const bcc = ref("");
  const subject = ref("");
  /** Body is the rich editor's HTML; the text/plain part is derived on send. */
  const body = ref("");
  /** Whether the CC / BCC lines are expanded (toggled from the To row). */
  const showCc = ref(false);
  const showBcc = ref(false);
  const sending = ref(false);
  const savingDraft = ref(false);
  const draftId = ref<string | null>(null);
  const error = ref<string | null>(null);

  const { data: accounts } = useAccounts();
  const { mutate: syncAccounts } = useSyncAccounts();

  const canSend = computed(() => to.value.trim().length > 0 && accountId.value.length > 0);

  /** Accounts as { value, label } options for the From dropdown. */
  const accountOptions = computed(() =>
    (accounts.value ?? []).map((a) => ({ value: a.id, label: `${a.name} <${a.email}>` })),
  );

  /** Split a comma-separated recipient string into trimmed, non-empty entries. */
  function recipients(value: string): string[] {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** The account's Sent mailbox id (if it has one), to land on after sending. */
  async function findSentMailbox(accountId: string): Promise<string | null> {
    try {
      const { mailboxes } = await api.mailboxes(accountId);
      return mailboxes.find((m) => m.role === "sent")?.id ?? null;
    } catch {
      return null;
    }
  }

  async function send() {
    if (!canSend.value) return;
    sending.value = true;
    error.value = null;
    try {
      await api.send({
        accountId: accountId.value,
        to: recipients(to.value),
        cc: recipients(cc.value),
        bcc: recipients(bcc.value),
        subject: subject.value,
        html: body.value,
        text: editorRef.value?.getText() ?? "",
        inReplyTo: null,
        references: [],
        newAttachments: attachments.value,
      });
      if (draftId.value) await api.delete([draftId.value]);
      toastSuccess(t("compose.sendSuccess"));
      // Auto-sync the account so the just-sent mail is pulled into its Sent
      // folder. The sync runs server-side and is not awaited — the account
      // state poller shows progress — so we land on the Sent folder to see it.
      syncAccounts([accountId.value]);
      const sentId = await findSentMailbox(accountId.value);
      await router.push({ name: "mailbox", query: sentId ? { mailbox: sentId } : {} });
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to send";
    } finally {
      sending.value = false;
    }
  }

  async function saveDraft() {
    savingDraft.value = true;
    error.value = null;
    try {
      await api.saveDraft({
        accountId: accountId.value,
        to: recipients(to.value),
        cc: recipients(cc.value),
        bcc: recipients(bcc.value),
        subject: subject.value,
        html: body.value,
        text: editorRef.value?.getText() ?? "",
      });
      toastSuccess(t("compose.draftSaved"));
      // The draft now lives in the provider's Drafts folder; sync the account
      // so it appears there (the sync mutation marks it running + refreshes).
      syncAccounts([accountId.value]);
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to save draft";
    } finally {
      savingDraft.value = false;
    }
  }

  function discard() {
    // Remove the provider draft if we opened an existing one.
    if (draftId.value) void api.delete([draftId.value]);
    void router.push({ name: "mailbox" });
  }

  /**
   * Initialize the form from the route: default the From account, prefill from
   * query (reply), and load a draft from the provider's Drafts folder. Call
   * from the component's onMounted.
   */
  function init() {
    // Default the From account once the account list loads (query fetches on
    // mount; this watcher fires when it resolves).
    watch(accounts, (list) => {
      if (accountId.value === "" && list && list.length > 0) accountId.value = list[0].id;
    });
    // Prefill from query (reply).
    if (route.query.to) to.value = route.query.to as string;
    if (route.query.subject) subject.value = route.query.subject as string;

    // Load a draft from the provider's Drafts folder (compose/:draftId where
    // draftId is the message id). api.message() reads the body without marking
    // the message read.
    const draftParam = route.params.draftId as string | undefined;
    if (draftParam) {
      draftId.value = draftParam;
      void (async () => {
        try {
          const { message } = await api.message(draftParam);
          if (message.accountId) accountId.value = message.accountId;
          to.value = message.to.map((a) => a.address).join(", ");
          cc.value = message.cc.map((a) => a.address).join(", ");
          bcc.value = message.bcc.map((a) => a.address).join(", ");
          showCc.value = message.cc.length > 0;
          showBcc.value = message.bcc.length > 0;
          subject.value = message.subject ?? "";
          body.value = message.html ?? message.text ?? "";
        } catch (err) {
          // The draft is gone upstream — the api layer already toasted the
          // reason and the backend pruned the stale row, so leave compose. Any
          // other error leaves us here with the (empty) form and its own toast.
          if (err instanceof ApiError && err.code === "message_gone") {
            await router.replace({ name: "mailbox" });
          }
        }
      })();
    }
  }

  return {
    accountId,
    to,
    cc,
    bcc,
    subject,
    body,
    showCc,
    showBcc,
    sending,
    savingDraft,
    draftId,
    error,
    canSend,
    accountOptions,
    send,
    saveDraft,
    discard,
    init,
  };
}
