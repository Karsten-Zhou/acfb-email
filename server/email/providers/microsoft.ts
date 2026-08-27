// Microsoft Outlook provider via Microsoft Graph.
// providerId = the `id` of a Graph message. Graph returns message ids like
// "AAMkAD...=" which are URL-safe but should still be encoded in paths.
import type {
  IEmailProvider,
  ProviderAttachment,
  ProviderBody,
  ProviderFetchResult,
  ProviderMailbox,
  ProviderMessage,
  ProviderPageResult,
  ProviderSyncOptions,
  SaveDraftOptions,
  SendOptions,
} from "./types";
import {
  providerGet,
  providerJson,
  providerJsonPatch,
  base64url,
  b64urlToBytes,
} from "./oauth-util";
import type { OAuthToken } from "../../oauth/client";

const GRAPH = "https://graph.microsoft.com/v1.0";

// Request immutable Graph message ids (stable across folder moves) so the
// per-mailbox (mailbox_id, remote_message_id) dedup key survives a move. The
// Prefer header must be sent on every message request so ids stay consistent.
const IMMUTABLE_ID_HEADER = { Prefer: 'IdType="ImmutableId"' };

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
  attachments?: GraphAttachment[];
  messageRules?: unknown;
}

interface GraphAttachment {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
  contentBytes?: string;
  "@odata.type"?: string;
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
    const { status, json, errorText } = await providerGet(
      `${GRAPH}/me/mailFolders?$select=id,displayName,parentFolderId`,
      this.token.access_token,
    );
    if (status !== 200) throw new Error(`Failed to list Outlook folders (${errorText ?? status})`);
    const folders = (json as { value?: { id: string; displayName: string }[] }).value ?? [];
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
      const { status, json } = await providerGet(
        `${GRAPH}/me/mailFolders/${known}?$select=id,displayName`,
        this.token.access_token,
      );
      if (status !== 200) return { messages: [], highestUid: 0, uidValidity: null, total: 0 };
      const f = json as { id: string; displayName: string };
      void f;
      return this.syncFolder(known, options);
    }
    const folderId = await this.folderIdByName(mailboxPath);
    if (!folderId) return { messages: [], highestUid: 0, uidValidity: null, total: 0 };
    return this.syncFolder(folderId, options);
  }

  private async folderIdByName(name: string): Promise<string | null> {
    const { status, json } = await providerGet(
      `${GRAPH}/me/mailFolders?$select=id,displayName`,
      this.token.access_token,
    );
    if (status !== 200) return null;
    const folders = (json as { value?: { id: string; displayName: string }[] }).value ?? [];
    const f = folders.find((x) => x.displayName === name);
    return f?.id ?? null;
  }

  private async syncFolder(
    folderId: string,
    options: ProviderSyncOptions,
  ): Promise<ProviderFetchResult> {
    const top = Math.min(options.fetchLimit ?? 100, 50);
    let url = `${GRAPH}/me/mailFolders/${folderId}/messages?$top=${top}&$orderby=sentDateTime%20desc&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,bodyPreview,internetMessageId,conversationId,hasAttachments`;
    if (options.sinceUid) {
      // approximate incremental: use sentDateTime filter (ISO from uid marker);
      // $filter and $orderby both reference sentDateTime (Graph requirement).
      const sinceDate = new Date(Math.max(options.sinceUid, 0)).toISOString();
      url += `&$filter=sentDateTime gt ${sinceDate}`;
    }
    const { status, json, errorText } = await providerGet(
      url,
      this.token.access_token,
      IMMUTABLE_ID_HEADER,
    );
    if (status !== 200) throw new Error(`Failed to list Outlook messages (${errorText ?? status})`);
    const msgs = (json as { value?: GraphMessage[] }).value ?? [];
    const out: ProviderMessage[] = msgs.map(mapGraphMessage);
    const highestUid = out.length ? Math.max(...out.map((o) => o.remoteUid)) : 0;
    return { messages: out, highestUid, uidValidity: null, total: msgs.length };
  }

  async fetchOlder(mailboxPath: string, options: ProviderSyncOptions): Promise<ProviderPageResult> {
    const folders = await this.listMailboxes();
    const folder = folders.find((f) => f.name === mailboxPath);
    const folderId = folder ? await this.folderIdByName(mailboxPath) : null;
    if (!folderId) return { messages: [], hasMore: false };
    const top = Math.min(options.fetchLimit ?? 50, 50);
    let url = `${GRAPH}/me/mailFolders/${folderId}/messages?$top=${top}&$orderby=receivedDateTime%20desc&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,bodyPreview,internetMessageId,conversationId,hasAttachments`;
    if (options.beforeDate) {
      // Per Graph docs, $filter and $orderby must reference the same property
      // (receivedDateTime here) or the request fails with InefficientFilter.
      url += `&$filter=receivedDateTime lt ${new Date(options.beforeDate).toISOString()}`;
    } else if (options.beforeUid) {
      url += `&$filter=receivedDateTime lt ${new Date(options.beforeUid).toISOString()}`;
    }
    const { status, json, errorText } = await providerGet(
      url,
      this.token.access_token,
      IMMUTABLE_ID_HEADER,
    );
    if (status !== 200) throw new Error(`Failed to list Outlook messages (${errorText ?? status})`);
    const msgs = (json as { value?: GraphMessage[] }).value ?? [];
    // Graph returns @odata.nextLink when more pages exist.
    const nextLink = (json as { "@odata.nextLink"?: string })["@odata.nextLink"];
    const out: ProviderMessage[] = msgs.map(mapGraphMessage);
    return { messages: out, hasMore: !!nextLink || msgs.length === top };
  }

  async fetchBody(mailboxPath: string, providerId: string): Promise<ProviderBody> {
    const url = `${GRAPH}/me/messages/${encodeURIComponent(providerId)}?$select=id,body,hasAttachments`;
    const { status, json, errorText } = await providerGet(
      url,
      this.token.access_token,
      IMMUTABLE_ID_HEADER,
    );
    if (status !== 200) throw new Error(`Failed to fetch Outlook message (${errorText ?? status})`);
    const m = json as GraphMessage;
    const bodyHtml = m.body?.contentType === "html" ? (m.body.content ?? null) : null;
    const bodyText = m.body?.contentType === "text" ? (m.body.content ?? null) : null;
    // Consumer accounts don't support $expand on attachments — list them via
    // the dedicated attachment endpoint instead.
    const attList = await providerGet(
      `${GRAPH}/me/messages/${encodeURIComponent(providerId)}/attachments`,
      this.token.access_token,
      IMMUTABLE_ID_HEADER,
    );
    let atts: GraphAttachment[] = [];
    if (attList.status === 200) {
      atts = ((attList.json as { value?: GraphAttachment[] }).value ?? []).filter(
        (a) => a["@odata.type"] !== "#microsoft.graph.referenceAttachment",
      );
    }
    const attachments = atts.map((a) => ({
      filename: a.name ?? null,
      mimeType: a.contentType ?? "application/octet-stream",
      size: a.size ?? 0,
      isInline: !!a.isInline,
      contentId: a.contentId ?? null,
      contentBase64: null, // content fetched on demand via attachment id
      partNumber: a.id,
      disposition: (a.isInline ? "inline" : "attachment") as "attachment" | "inline",
    }));
    return { html: bodyHtml, text: bodyText, attachments };
  }

  async fetchAttachment(
    mailboxPath: string,
    providerId: string,
    partNumber: string | null,
  ): Promise<ProviderAttachment> {
    if (!partNumber) throw new Error("Missing Outlook attachment id");
    const { status, json, errorText } = await providerGet(
      `${GRAPH}/me/messages/${encodeURIComponent(providerId)}/attachments/${encodeURIComponent(partNumber)}`,
      this.token.access_token,
      IMMUTABLE_ID_HEADER,
    );
    if (status !== 200)
      throw new Error(`Failed to fetch Outlook attachment (${errorText ?? status})`);
    const a = json as GraphAttachment;
    const decoded = b64urlToBytes(a.contentBytes);
    if (!decoded || decoded.byteLength === 0) throw new Error("Outlook attachment body missing");
    return {
      filename: a.name ?? null,
      mimeType: a.contentType ?? "application/octet-stream",
      data: decoded,
    };
  }

  async setFlags(
    mailboxPath: string,
    providerIds: string[],
    flags: { read?: boolean; starred?: boolean },
  ): Promise<void> {
    for (const id of providerIds) {
      const patch: Record<string, unknown> = {};
      if (flags.read !== undefined) patch.isRead = flags.read;
      if (flags.starred !== undefined)
        patch.flag = { flagStatus: flags.starred ? "flagged" : "notFlagged" };
      await providerJsonPatch(
        `${GRAPH}/me/messages/${encodeURIComponent(id)}`,
        this.token.access_token,
        patch,
        IMMUTABLE_ID_HEADER,
      );
    }
  }

  async move(mailboxPath: string, providerIds: string[], targetMailboxPath: string): Promise<void> {
    const targetId = await this.folderIdByName(targetMailboxPath);
    if (!targetId) throw new Error("Target Outlook folder not found");
    for (const id of providerIds) {
      await providerJson(
        `${GRAPH}/me/messages/${encodeURIComponent(id)}/move`,
        this.token.access_token,
        {
          destinationId: targetId,
        },
        "POST",
        IMMUTABLE_ID_HEADER,
      );
    }
  }

  async delete(mailboxPath: string, providerIds: string[]): Promise<void> {
    for (const id of providerIds) {
      await providerJson(
        `${GRAPH}/me/messages/${encodeURIComponent(id)}`,
        this.token.access_token,
        {},
        "DELETE",
        IMMUTABLE_ID_HEADER,
      );
    }
  }

  async send(opts: SendOptions): Promise<void> {
    const message: Record<string, unknown> = {
      subject: opts.subject,
      body: {
        contentType: opts.html ? "html" : "text",
        content: opts.html || opts.text || "",
      },
      toRecipients: opts.to.map((a) => ({ emailAddress: { address: a } })),
      ccRecipients: (opts.cc ?? []).map((a) => ({ emailAddress: { address: a } })),
      bccRecipients: (opts.bcc ?? []).map((a) => ({ emailAddress: { address: a } })),
    };
    // The raw MIME (built by mimetext) may carry attachments (compose uploads);
    // extract them and re-attach via Graph's fileAttachment format.
    const attachments = await extractOutgoingAttachments(opts.rawMessage);
    if (attachments.length > 0) {
      message.hasAttachments = true;
      message.attachments = attachments.map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.filename,
        contentType: a.mimeType,
        contentBytes: a.base64,
      }));
    }
    const { status, json, errorText } = await providerJson(
      `${GRAPH}/me/sendMail`,
      this.token.access_token,
      { message },
      "POST",
      IMMUTABLE_ID_HEADER,
    );
    if (status !== 202 && status !== 201)
      throw new Error(`Outlook send failed (${errorText ?? status})`);
    void json;
    void base64url;
    void b64urlToBytes;
  }

  /** Create a draft message in the Drafts folder (Mail.ReadWrite scope). */
  async saveDraft(opts: SaveDraftOptions): Promise<void> {
    const message: Record<string, unknown> = {
      subject: opts.subject,
      body: {
        contentType: opts.html ? "html" : "text",
        content: opts.html || opts.text || "",
      },
      toRecipients: opts.to.map((a) => ({ emailAddress: { address: a } })),
      ccRecipients: (opts.cc ?? []).map((a) => ({ emailAddress: { address: a } })),
      bccRecipients: (opts.bcc ?? []).map((a) => ({ emailAddress: { address: a } })),
    };
    const { status, errorText } = await providerJson(
      `${GRAPH}/me/mailFolders/drafts/messages`,
      this.token.access_token,
      message,
      "POST",
      IMMUTABLE_ID_HEADER,
    );
    if (status !== 201 && status !== 200)
      throw new Error(`Outlook draft save failed (${errorText ?? status})`);
  }
}

/**
 * Pull the attachments out of a built MIME message (mimetext output) so REST
 * providers (Graph) can attach them through their own API. Returns base64
 * content bytes as Graph expects.
 */
async function extractOutgoingAttachments(
  raw: Uint8Array,
): Promise<{ filename: string; mimeType: string; base64: string }[]> {
  const { default: PostalMime } = await import("postal-mime");
  const email = await PostalMime.parse(raw);
  const out: { filename: string; mimeType: string; base64: string }[] = [];
  for (const a of email.attachments ?? []) {
    if (!a.content || a.disposition === "inline") continue;
    const content =
      a.content instanceof Uint8Array
        ? a.content
        : new Uint8Array(
            a.content instanceof ArrayBuffer ? a.content : new TextEncoder().encode(a.content),
          );
    let bin = "";
    for (let i = 0; i < content.length; i++) bin += String.fromCharCode(content[i]);
    // Graph expects standard base64 (not url-safe) in contentBytes.
    out.push({
      filename: a.filename ?? "attachment",
      mimeType: a.mimeType ?? "application/octet-stream",
      base64: btoa(bin),
    });
  }
  return out;
}

function mapGraphMessage(m: GraphMessage): ProviderMessage {
  return {
    providerId: m.id,
    remoteUid: oidToUid(m.id),
    messageId: m.internetMessageId ?? null,
    subject: m.subject ?? null,
    from: m.from?.emailAddress
      ? { name: m.from.emailAddress.name ?? null, address: m.from.emailAddress.address ?? null }
      : null,
    to: (m.toRecipients ?? []).map((r) => ({
      name: r.emailAddress?.name ?? null,
      address: r.emailAddress?.address ?? null,
    })),
    cc: (m.ccRecipients ?? []).map((r) => ({
      name: r.emailAddress?.name ?? null,
      address: r.emailAddress?.address ?? null,
    })),
    date: m.sentDateTime ?? null,
    internalDate: m.receivedDateTime ?? null,
    flags: m.isRead ? ["\\Seen"] : [],
    size: null,
    hasAttachments: !!m.hasAttachments,
  };
}

function oidToUid(oid: string): number {
  let h = 0;
  for (let i = 0; i < oid.length; i++) h = (h * 31 + oid.charCodeAt(i)) >>> 0;
  return h;
}
