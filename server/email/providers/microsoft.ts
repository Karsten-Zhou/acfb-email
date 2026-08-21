// Microsoft Outlook provider via Microsoft Graph.
// providerId = the `id` of a Graph message. Graph returns message ids like
// "AAMkAD...=" which are URL-safe but should still be encoded in paths.
import type {
  IEmailProvider,
  ProviderBody,
  ProviderFetchResult,
  ProviderMailbox,
  ProviderMessage,
  ProviderSyncOptions,
  SendOptions,
} from "./types";
import { providerGet, providerJson, providerJsonPatch, base64url, b64urlToBytes } from "./oauth-util";
import type { OAuthToken } from "../../oauth/client";

const GRAPH = "https://graph.microsoft.com/v1.0";

interface GraphAddress {
  name?: string;
  address?: string;
}
interface GraphRecipient {
  emailAddress?: GraphAddress;
}
interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: GraphAddress };
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  internetMessageId?: string;
  conversationId?: string;
  messageRules?: unknown;
}

export class MicrosoftProvider implements IEmailProvider {
  readonly type = "microsoft" as const;

  constructor(
    private token: OAuthToken,
    private fromAddress: string,
  ) {}

  async testConnection(): Promise<{ ok: true }> {
    const r = await providerGet(`${GRAPH}/me`, this.token.access_token);
    if (r.status === 401) throw new Error("Outlook authentication failed");
    if (r.status !== 200) throw new Error("Outlook connection failed");
    return { ok: true };
  }

  async listMailboxes(): Promise<ProviderMailbox[]> {
    const { status, json } = await providerGet(`${GRAPH}/me/mailFolders?$select=id,displayName,parentFolderId`, this.token.access_token);
    if (status !== 200) throw new Error("Failed to list Outlook folders");
    const folders = ((json as { value?: { id: string; displayName: string }[] }).value ?? []);
    // Include standard well-known folders plus favorites; use displayName as path.
    return folders.map((f) => ({ name: f.displayName, delimiter: "/", flags: [] }));
  }

  async syncMailbox(
    mailboxPath: string,
    options: ProviderSyncOptions,
  ): Promise<ProviderFetchResult> {
    // Find the folder id by displayName (call listMailboxes).
    const folders = await this.listMailboxes();
    const folder = folders.find((f) => f.name === mailboxPath);
    if (!folder) {
      // Try well-known names.
      const wellKnown: Record<string, string> = {
        Inbox: "inbox",
        Sent: "sentitems",
        Drafts: "drafts",
        Trash: "deleteditems",
        Junk: "junkemail",
        Archive: "archive",
      };
      const known = wellKnown[mailboxPath];
      if (!known) return { messages: [], highestUid: 0, uidValidity: null, total: 0 };
      const { status, json } = await providerGet(`${GRAPH}/me/mailFolders/${known}?$select=id,displayName`, this.token.access_token);
      if (status !== 200) return { messages: [], highestUid: 0, uidValidity: null, total: 0 };
      const f = (json as { id: string; displayName: string });
      void f;
      return this.syncFolder(known, options);
    }
    const folderId = await this.folderIdByName(mailboxPath);
    if (!folderId) return { messages: [], highestUid: 0, uidValidity: null, total: 0 };
    return this.syncFolder(folderId, options);
  }

  private async folderIdByName(name: string): Promise<string | null> {
    const { status, json } = await providerGet(`${GRAPH}/me/mailFolders?$select=id,displayName`, this.token.access_token);
    if (status !== 200) return null;
    const folders = ((json as { value?: { id: string; displayName: string }[] }).value ?? []);
    const f = folders.find((x) => x.displayName === name);
    return f?.id ?? null;
  }

  private async syncFolder(folderId: string, options: ProviderSyncOptions): Promise<ProviderFetchResult> {
    const top = Math.min(options.fetchLimit ?? 100, 50);
    let url = `${GRAPH}/me/mailFolders/${folderId}/messages?$top=${top}&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,bodyPreview,internetMessageId,conversationId,hasAttachments`;
    if (options.sinceUid) {
      // approximate incremental: use sentDateTime filter (ISO from uid marker)
      const sinceDate = new Date(Math.max(options.sinceUid, 0)).toISOString();
      url += `&$filter=sentDateTime gt ${sinceDate}`;
    }
    const { status, json } = await providerGet(url, this.token.access_token);
    if (status !== 200) throw new Error("Failed to list Outlook messages");
    const msgs = ((json as { value?: GraphMessage[] }).value ?? []);
    const out: ProviderMessage[] = msgs.map((m) => ({
      providerId: m.id,
      remoteUid: oidToUid(m.id),
      messageId: m.internetMessageId ?? null,
      subject: m.subject ?? null,
      from: m.from?.emailAddress ? { name: m.from.emailAddress.name ?? null, address: m.from.emailAddress.address ?? null } : null,
      to: (m.toRecipients ?? []).map((r) => ({ name: r.emailAddress?.name ?? null, address: r.emailAddress?.address ?? null })),
      cc: (m.ccRecipients ?? []).map((r) => ({ name: r.emailAddress?.name ?? null, address: r.emailAddress?.address ?? null })),
      date: m.sentDateTime ?? null,
      internalDate: m.receivedDateTime ?? null,
      flags: m.isRead ? ["\\Seen"] : [],
      size: null,
    }));
    const highestUid = out.length ? Math.max(...out.map((o) => o.remoteUid)) : 0;
    return { messages: out, highestUid, uidValidity: null, total: msgs.length };
  }

  async fetchBody(mailboxPath: string, providerId: string): Promise<ProviderBody> {
    const url = `${GRAPH}/me/messages/${encodeURIComponent(providerId)}?$select=id,body`;
    const { status, json } = await providerGet(url, this.token.access_token);
    if (status !== 200) throw new Error("Failed to fetch Outlook message");
    const m = json as GraphMessage;
    const bodyHtml = m.body?.contentType === "html" ? m.body.content ?? null : null;
    const bodyText = m.body?.contentType === "text" ? m.body.content ?? null : null;
    return { html: bodyHtml, text: bodyText, attachments: [] };
  }

  async setFlags(
    mailboxPath: string,
    providerIds: string[],
    flags: { read?: boolean; starred?: boolean },
  ): Promise<void> {
    for (const id of providerIds) {
      const patch: Record<string, unknown> = {};
      if (flags.read !== undefined) patch.isRead = flags.read;
      if (flags.starred !== undefined) patch.flag = { flagStatus: flags.starred ? "flagged" : "notFlagged" };
      await providerJsonPatch(`${GRAPH}/me/messages/${encodeURIComponent(id)}`, this.token.access_token, patch);
    }
  }

  async move(
    mailboxPath: string,
    providerIds: string[],
    targetMailboxPath: string,
  ): Promise<void> {
    const targetId = await this.folderIdByName(targetMailboxPath);
    if (!targetId) throw new Error("Target Outlook folder not found");
    for (const id of providerIds) {
      await providerJson(`${GRAPH}/me/messages/${encodeURIComponent(id)}/move`, this.token.access_token, {
        destinationId: targetId,
      });
    }
  }

  async delete(mailboxPath: string, providerIds: string[]): Promise<void> {
    for (const id of providerIds) {
      await providerJson(`${GRAPH}/me/messages/${encodeURIComponent(id)}`, this.token.access_token, {}, "DELETE");
    }
  }

  async send(opts: SendOptions): Promise<void> {
    const message = {
      subject: opts.subject,
      body: {
        contentType: opts.html ? "html" : "text",
        content: opts.html || opts.text || "",
      },
      toRecipients: opts.to.map((a) => ({ emailAddress: { address: a } })),
      ccRecipients: (opts.cc ?? []).map((a) => ({ emailAddress: { address: a } })),
      bccRecipients: (opts.bcc ?? []).map((a) => ({ emailAddress: { address: a } })),
    };
    const { status, json } = await providerJson(`${GRAPH}/me/sendMail`, this.token.access_token, { message }, "POST");
    if (status !== 202 && status !== 201) throw new Error(`Outlook send failed (${status})`);
    void json;
    void base64url;
    void b64urlToBytes;
  }
}

function oidToUid(oid: string): number {
  let h = 0;
  for (let i = 0; i < oid.length; i++) h = (h * 31 + oid.charCodeAt(i)) >>> 0;
  return h;
}