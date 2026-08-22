// Thin typed API client for the backend.
import type {
  AccountDetail,
  AccountSummary,
  AddAccountInput,
  Mailbox,
  Message,
  MessageDetail,
  SendMessageInput,
  User,
} from "@shared/types";

const CSRF_HEADER = "x-csrf-token";
const CSRF_COOKIE = "ec_csrf";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const m = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const method = (init.method ?? "GET").toUpperCase();
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = csrfToken();
    if (csrf) headers.set(CSRF_HEADER, csrf);
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
    // Session gone (GitHub credential missing/revoked/expired): return the
    // user to the login page instead of leaving a broken authed view up.
    if (res.status === 401) await handleUnauthorized();
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Session is no longer valid — reset auth state and navigate to /login.
 * Uses dynamic imports to avoid a circular dependency (auth store / router
 * both import from this module's `api`).
 *
 * The navigation is deferred to the next microtask so it never re-enters a
 * vue-router navigation that's currently in flight (e.g. the initial guard
 * running `bootstrap()` after a reload).
 */
async function handleUnauthorized(): Promise<void> {
  const { authState } = await import("../stores/auth");
  if (authState.user !== null || authState.ready) {
    authState.user = null;
    authState.ready = true;
  }
  const { router } = await import("../router");
  const current = router.currentRoute.value?.name;
  if (current && current !== "login") {
    // Defer so we don't navigate mid-guard.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (router.currentRoute.value.name !== "login" && !authState.user) {
      await router.replace({ name: "login" });
    }
  }
}

export const api = {
  // meta
  health: () => request<HealthPayload>("/health"),

  // auth
  me: () => request<{ user: User }>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  // accounts
  accounts: () => request<{ accounts: AccountSummary[] }>("/accounts"),
  account: (id: string) => request<{ account: AccountDetail }>(`/accounts/${id}`),
  addAccount: (input: AddAccountInput) =>
    request<{ account: AccountSummary }>("/accounts", { method: "POST", body: JSON.stringify(input) }),
  testAccount: (input: AddAccountInput) =>
    request<{ ok: boolean; message?: string }>("/accounts/test", { method: "POST", body: JSON.stringify(input) }),
  deleteAccount: (id: string) => request<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" }),
  syncAccount: (id: string) =>
    request<{ ok: boolean; mailboxesSynced?: number; messagesSeen?: number; message?: string }>(
      `/accounts/${id}/sync`,
      { method: "POST" },
    ),

  // mailboxes
  mailboxes: (accountId: string) => request<{ mailboxes: Mailbox[] }>(`/mailboxes?accountId=${encodeURIComponent(accountId)}`),

  // messages
  messages: (mailboxId: string, limit = 50, offset = 0, beforeUid?: number, beforeDate?: number) =>
    request<{ messages: Message[] }>(`/messages?mailboxId=${encodeURIComponent(mailboxId)}&limit=${limit}&offset=${offset}${beforeUid ? `&beforeUid=${beforeUid}` : ""}${beforeDate ? `&beforeDate=${beforeDate}` : ""}`),
  unified: (limit = 50, offset = 0) =>
    request<{ messages: Message[] }>(`/messages/unified?limit=${limit}&offset=${offset}`),
  message: (id: string) => request<{ message: MessageDetail }>(`/messages/${encodeURIComponent(id)}`),
  flags: (ids: string[], flags: { read?: boolean; starred?: boolean }) =>
    request<{ ok: boolean }>("/messages/flags", { method: "PATCH", body: JSON.stringify({ ids, ...flags }) }),
  move: (ids: string[], targetMailboxId: string) =>
    request<{ ok: boolean }>("/messages/move", { method: "POST", body: JSON.stringify({ ids, targetMailboxId }) }),
  delete: (ids: string[]) =>
    request<{ ok: boolean }>("/messages/delete", { method: "POST", body: JSON.stringify({ ids }) }),

  // send / drafts
  send: (input: SendMessageInput) => request<{ ok: boolean }>("/send/send", { method: "POST", body: JSON.stringify(input) }),
  drafts: () => request<{ drafts: Draft[] }>("/send/drafts"),
  saveDraft: (draft: Partial<DraftInput>) =>
    request<{ ok: boolean; id: string }>("/send/drafts", { method: "POST", body: JSON.stringify(draft) }),
  deleteDraft: (id: string) => request<{ ok: boolean }>(`/send/drafts/${id}`, { method: "DELETE" }),

  // settings
  settings: () => request<{ settings: Record<string, unknown> }>("/settings"),
  saveSettings: (settings: Record<string, unknown>) =>
    request<{ ok: boolean }>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
};

export interface Draft {
  id: string;
  accountId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  updatedAt: string;
}

export interface DraftInput {
  id?: string;
  accountId?: string | null;
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
    githubOauth: boolean;
  };
}