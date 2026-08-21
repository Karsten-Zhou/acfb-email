// Gmail REST provider (Gmail API over HTTPS).
// Each message's `providerId` is the Gmail message string id; `remoteUid` is a
// deterministic numeric derived from it for ordering (the string id stays in
// messages.remote_message_id via sync).
import type {
  IEmailProvider,
  ProviderBody,
  ProviderFetchResult,
  ProviderMailbox,
  ProviderMessage,
  ProviderSyncOptions,
  SendOptions,
} from "./types";
import { b64urlToBytes, base64url, providerGet, providerJson, providerJsonPatch } from "./oauth-util";
import type { OAuthToken } from "../../oauth/client";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailNameValue {
  name: string;
  value: string;
}
interface GmailPayload {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number; inlineId?: string };
  parts?: GmailPayload[];
  headers?: GmailNameValue[];
}
interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  sizeEstimate?: number;
  payload?: GmailPayload;
}

export class GmailProvider implements IEmailProvider {
  readonly type = "gmail" as const;

  constructor(
    private token: OAuthToken,
    private fromAddress: string,
  ) {}

  async testConnection(): Promise<{ ok: true }> {
    const r = await providerGet(`${API}/profile`, this.token.access_token);
    if (r.status !== 200) throw new Error("Gmail connection failed");
    return { ok: true };
  }

  async listMailboxes(): Promise<ProviderMailbox[]> {
    const { status, json } = await providerGet(`${API}/labels`, this.token.access_token);
    if (status !== 200) throw new Error("Failed to list Gmail labels");
    const labels = ((json as { labels?: { id: string; name: string }[] }).labels ?? []);
    return labels.map((l) => ({ name: l.name, delimiter: "/", flags: [] }));
  }

  async syncMailbox(
    mailboxPath: string,
    options: ProviderSyncOptions,
  ): Promise<ProviderFetchResult> {
    const label = mailboxPath.toUpperCase() === "INBOX" ? "INBOX" : mailboxPath;
    const max = options.fetchLimit ?? 100;
    const qs = new URLSearchParams({ labelIds: label, maxResults: String(max) });
    if (options.sinceUid) {
      // Gmail can't query by uid; we limit to recent via 'after:' using a date
      // derived from sinceUid is impossible, so use maxResults paging + newest.
      void options.sinceUid;
    }
    const { status, json } = await providerGet(`${API}/messages?${qs}`, this.token.access_token);
    if (status !== 200) throw new Error("Failed to list Gmail messages");
    const list = ((json as { messages?: { id: string; threadId: string }[] }).messages ?? []);

    const out: ProviderMessage[] = [];
    for (const m of list) {
      const meta = await this.fetchMessageMeta(m.id);
      if (meta) out.push(meta);
    }
    const highestUid = out.length ? Math.max(...out.map((o) => o.remoteUid)) : 0;
    return { messages: out, highestUid, uidValidity: null, total: list.length };
  }

  private async fetchMessageMeta(gmailId: string): Promise<ProviderMessage | null> {
    const qs = new URLSearchParams({ format: "metadata" });
    for (const h of ["From", "To", "Cc", "Subject", "Date", "Message-ID"]) qs.append("metadataHeaders", h);
    const { status, json } = await providerGet(`${API}/messages/${encodeURIComponent(gmailId)}?${qs}`, this.token.access_token);
    if (status !== 200) return null;
    const d = json as GmailMessage;
    const h = headerMap(d.payload?.headers ?? []);
    const flags = d.labelIds ?? [];
    return {
      providerId: gmailId,
      remoteUid: hashUid(gmailId),
      messageId: h["message-id"] ?? null,
      subject: h["subject"] ?? null,
      from: splitAddresses(h["from"])[0] ?? { name: null, address: null },
      to: splitAddresses(h["to"]),
      cc: splitAddresses(h["cc"]),
      date: h["date"] ?? null,
      internalDate: d.internalDate ? new Date(parseInt(d.internalDate, 10)).toISOString() : null,
      flags,
      size: d.sizeEstimate ?? null,
    };
  }

  async fetchBody(mailboxPath: string, providerId: string): Promise<ProviderBody> {
    const { status, json } = await providerGet(`${API}/messages/${encodeURIComponent(providerId)}?format=full`, this.token.access_token);
    if (status !== 200) throw new Error("Failed to fetch Gmail message");
    const d = json as GmailMessage;
    const html = extractBody(d.payload, "text/html");
    const text = extractBody(d.payload, "text/plain");
    const attachments = extractAttachments(d.payload);
    return { html, text, attachments };
  }

  async setFlags(
    mailboxPath: string,
    providerIds: string[],
    flags: { read?: boolean; starred?: boolean },
  ): Promise<void> {
    for (const id of providerIds) {
      const add: string[] = [];
      const remove: string[] = [];
      if (flags.starred === true) add.push("STARRED");
      if (flags.starred === false) remove.push("STARRED");
      if (flags.read === false) add.push("UNREAD");
      if (flags.read === true) remove.push("UNREAD");
      await providerJsonPatch(`${API}/messages/${encodeURIComponent(id)}/modify`, this.token.access_token, {
        addLabelIds: add,
        removeLabelIds: remove,
      });
    }
  }

  async move(
    mailboxPath: string,
    providerIds: string[],
    targetMailboxPath: string,
  ): Promise<void> {
    const target = targetMailboxPath.toUpperCase() === "TRASH" ? "TRASH" : targetMailboxPath;
    const source = mailboxPath.toUpperCase() === "INBOX" ? "INBOX" : mailboxPath;
    for (const id of providerIds) {
      await providerJsonPatch(`${API}/messages/${encodeURIComponent(id)}/modify`, this.token.access_token, {
        addLabelIds: [target],
        removeLabelIds: source === target ? [] : [source, "INBOX"],
      });
    }
  }

  async delete(mailboxPath: string, providerIds: string[]): Promise<void> {
    for (const id of providerIds) {
      await providerJsonPatch(`${API}/messages/${encodeURIComponent(id)}/modify`, this.token.access_token, {
        addLabelIds: ["TRASH"],
        removeLabelIds: [],
      });
    }
  }

  async send(opts: SendOptions): Promise<void> {
    const b64 = base64url(opts.rawMessage);
    const { status, json } = await providerJson(
      `${API}/messages/send`,
      this.token.access_token,
      { raw: b64 },
      "POST",
    );
    if (status !== 200) throw new Error(`Gmail send failed (${status})`);
    void json;
  }
}

function headerMap(headers: GmailNameValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value;
  return out;
}

function splitAddresses(v: string | undefined): { name: string | null; address: string | null }[] {
  if (!v) return [];
  return v.split(",").map((a) => {
    const m = /<([^>]+)>/.exec(a);
    if (m) return { name: (a.slice(0, m.index).trim() || null), address: m[1].trim() };
    return { name: null, address: a.trim() };
  });
}

function extractBody(payload: GmailPayload | undefined, mime: string): string | null {
  if (!payload) return null;
  if (payload.mimeType === mime && payload.body?.data) {
    const bytes = b64urlToBytes(payload.body.data);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }
  for (const part of payload.parts ?? []) {
    const r = extractBody(part, mime);
    if (r) return r;
  }
  return null;
}

function extractAttachments(payload: GmailPayload | undefined): {
  filename: string | null;
  mimeType: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
  contentBase64: string | null;
}[] {
  const out: {
    filename: string | null;
    mimeType: string;
    size: number;
    isInline: boolean;
    contentId: string | null;
    contentBase64: string | null;
  }[] = [];
  const walk = (p: GmailPayload | undefined) => {
    if (!p) return;
    if (p.parts) {
      for (const part of p.parts) walk(part);
      return;
    }
    const hasAttachmentBody = p.body?.attachmentId !== undefined;
    const inline = p.body?.inlineId !== undefined;
    if (!hasAttachmentBody && !inline) return;
    out.push({
      filename: p.filename ?? null,
      mimeType: p.mimeType ?? "application/octet-stream",
      size: p.body?.size ?? 0,
      isInline: inline,
      contentId: p.body?.inlineId ?? null,
      contentBase64: null, // not fetched in v1 (would need attachments.get)
    });
  };
  walk(payload);
  return out;
}

/** Deterministic numeric uid from a Gmail string id (stable per message). */
export function hashUid(gmailId: string): number {
  let h = 0;
  for (let i = 0; i < gmailId.length; i++) h = (h * 31 + gmailId.charCodeAt(i)) >>> 0;
  return h;
}