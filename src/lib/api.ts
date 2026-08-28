// Thin typed API client for the backend.
import { reactive } from "vue";
import { toastError } from "../stores/toast";
import type {
  AccountDetail,
  AccountSummary,
  AddAccountInput,
  Mailbox,
  Message,
  MessageDetail,
  SendMessageInput,
} from "@shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** True when the API reported that Cloudflare Access isn't enabled (403). */
export const accessState = reactive({ missing: false });

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { noToast?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; code?: string };
      if (data.error) message = data.error;
      code = data.code;
    } catch {
      /* non-json */
    }
    // Cloudflare Access isn't enabled: switch to the "Access required" screen
    // instead of toasting every failing request.
    if (res.status === 403 && code === "access_required") {
      accessState.missing = true;
    } else if (!opts.noToast) {
      // Surface failures to the user unless the caller renders its own inline
      // error (e.g. the IMAP test-connection form).
      toastError(message);
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // meta
  health: () => request<HealthPayload>("/health"),

  // accounts
  accounts: () => request<{ accounts: AccountSummary[] }>("/accounts"),
  accountStates: () =>
    request<{
      accounts: {
        id: string;
        state: string;
        stateMessage: string | null;
        lastSyncedAt: string | null;
      }[];
    }>("/accounts/states", {}, { noToast: true }),
  account: (id: string) => request<{ account: AccountDetail }>(`/accounts/${id}`),
  addAccount: (input: AddAccountInput) =>
    request<{ account: AccountSummary }>("/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  testAccount: (input: AddAccountInput) =>
    request<{ ok: boolean; message?: string }>(
      "/accounts/test",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      // The form renders the ok/message inline under the fields; no toast.
      { noToast: true },
    ),
  deleteAccount: (id: string) => request<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" }),
  updateAccount: (
    id: string,
    patch: {
      name?: string;
      displayName?: string | null;
      syncEnabled?: boolean;
      sortOrder?: number;
    },
  ) =>
    request<{ ok: boolean }>(`/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  reorderAccounts: (orderedIds: string[]) =>
    request<{ ok: boolean }>("/accounts/order", {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    }),
  syncAccount: (id: string) =>
    request<{ ok: boolean; mailboxesSynced?: number; messagesSeen?: number; message?: string }>(
      `/accounts/${id}/sync`,
      { method: "POST" },
    ),

  // attachments
  /** Absolute URL that streams an attachment from its provider. */
  attachmentUrl: (messageId: string, attachmentId: string) =>
    `/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,

  // mailboxes
  mailboxes: (accountId: string) =>
    request<{ mailboxes: Mailbox[] }>(`/mailboxes?accountId=${encodeURIComponent(accountId)}`),

  // messages
  messages: (mailboxId: string, limit = 50, offset = 0, beforeUid?: number, beforeDate?: number) =>
    request<{ messages: Message[]; hasMore?: boolean }>(
      `/messages?mailboxId=${encodeURIComponent(mailboxId)}&limit=${limit}&offset=${offset}${beforeUid ? `&beforeUid=${beforeUid}` : ""}${beforeDate ? `&beforeDate=${beforeDate}` : ""}`,
    ),
  unified: (limit = 50, offset = 0) =>
    request<{ messages: Message[]; hasMore?: boolean }>(
      `/messages/unified?limit=${limit}&offset=${offset}`,
    ),
  message: (id: string) =>
    request<{ message: MessageDetail }>(`/messages/${encodeURIComponent(id)}`),
  flags: (ids: string[], flags: { read?: boolean; starred?: boolean }) =>
    request<{ ok: boolean }>("/messages/flags", {
      method: "PATCH",
      body: JSON.stringify({ ids, ...flags }),
    }),
  move: (ids: string[], targetMailboxId: string) =>
    request<{ ok: boolean }>("/messages/move", {
      method: "POST",
      body: JSON.stringify({ ids, targetMailboxId }),
    }),
  delete: (ids: string[]) =>
    request<{ ok: boolean }>("/messages/delete", { method: "POST", body: JSON.stringify({ ids }) }),

  // send / drafts
  send: (input: SendMessageInput) =>
    request<{ ok: boolean }>("/send/send", { method: "POST", body: JSON.stringify(input) }),
  /** Save a draft to the provider's Drafts folder. */
  saveDraft: (draft: DraftInput) =>
    request<{ ok: boolean }>("/send/drafts", {
      method: "POST",
      body: JSON.stringify(draft),
    }),

  // settings
  settings: () => request<{ settings: Record<string, unknown> }>("/settings"),
  saveSettings: (settings: Record<string, unknown>) =>
    request<{ ok: boolean }>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
};

export interface DraftInput {
  accountId: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  html?: string;
  text?: string;
}

export interface HealthPayload {
  ok: boolean;
  config: {
    gmailOauth: boolean;
    outlookOauth: boolean;
  };
}
