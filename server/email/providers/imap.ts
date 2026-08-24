// Generic IMAP/SMTP provider adapter. Uses the ImapClient and an SMTP send.
// Decouples protocol work from the provider interface so Gmail/Microsoft can
// be added without touching sync logic.

import { ImapClient, ImapError } from "../imap/client";
import { smtpSend } from "../smtp/client";
import type {
  IEmailProvider,
  ProviderAttachment,
  ProviderBody,
  ProviderFetchResult,
  ProviderMailbox,
  ProviderMessage,
  ProviderPageResult,
  ProviderSyncOptions,
  SendOptions,
} from "./types";

export interface ImapCredentials {
  username: string;
  password: string;
}

export interface ImapTransport {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export class ImapProvider implements IEmailProvider {
  readonly type = "imap" as const;

  constructor(
    private transport: ImapTransport,
    private creds: ImapCredentials,
    private fromAddress: string,
  ) {}

  private connectImap(): ImapClient {
    return new ImapClient({
      host: this.transport.imapHost,
      port: this.transport.imapPort,
      secure: this.transport.imapSecure,
      username: this.creds.username,
      password: this.creds.password,
    });
  }

  async testConnection(): Promise<{ ok: true }> {
    const imap = this.connectImap();
    try {
      await imap.connect();
      await imap.logout();
      return { ok: true };
    } finally {
      await imap.close().catch(() => {});
    }
  }

  async listMailboxes(): Promise<ProviderMailbox[]> {
    const imap = this.connectImap();
    try {
      await imap.connect();
      const boxes = await imap.listMailboxes();
      return boxes.map((b) => ({ name: b.name, delimiter: b.delimiter, flags: b.flags }));
    } finally {
      await imap.close().catch(() => {});
    }
  }

  async syncMailbox(
    mailboxPath: string,
    options: ProviderSyncOptions,
  ): Promise<ProviderFetchResult> {
    const imap = this.connectImap();
    try {
      await imap.connect();
      const sel = await imap.select(mailboxPath);

      let uids: number[];
      if (options.sinceUid && options.sinceUid > 0) {
        uids = await imap.searchUidsSince(options.sinceUid);
      } else {
        const all = await imap.searchAllUids();
        const limit = options.fetchLimit ?? 200;
        uids = all.slice(-limit); // newest `limit`
      }

      const envelopes = await imap.fetchHeadersByUid(uids);
      const messages: ProviderMessage[] = envelopes.map((e) => ({
        providerId: String(e.uid),
        remoteUid: e.uid,
        messageId: e.messageId,
        subject: e.subject,
        from: e.from,
        to: e.to,
        cc: e.cc,
        date: e.date,
        internalDate: e.internalDate,
        flags: e.flags,
        size: e.size,
      }));
      const highestUid = uids.length ? Math.max(...uids) : 0;
      const result: ProviderFetchResult = {
        messages,
        highestUid,
        uidValidity: sel.uidValidity,
        total: sel.total,
      };
      return result;
    } finally {
      await imap.close().catch(() => {});
    }
  }

  async fetchOlder(mailboxPath: string, options: ProviderSyncOptions): Promise<ProviderPageResult> {
    const imap = this.connectImap();
    try {
      await imap.connect();
      await imap.select(mailboxPath);

      if (!options.beforeUid || options.beforeUid <= 1) {
        return { messages: [], hasMore: false };
      }
      const all = await imap.searchUidsBefore(options.beforeUid);
      const limit = options.fetchLimit ?? 50;
      const uids = all.slice(-limit); // the `limit` most recent of those older than the cursor
      if (uids.length === 0) return { messages: [], hasMore: false };

      const envelopes = await imap.fetchHeadersByUid(uids);
      const messages: ProviderMessage[] = envelopes.map((e) => ({
        providerId: String(e.uid),
        remoteUid: e.uid,
        messageId: e.messageId,
        subject: e.subject,
        from: e.from,
        to: e.to,
        cc: e.cc,
        date: e.date,
        internalDate: e.internalDate,
        flags: e.flags,
        size: e.size,
      }));
      return {
        messages,
        // If we got a full page, there are (likely) more even older messages.
        hasMore: uids.length === limit && all.length > limit,
      };
    } finally {
      await imap.close().catch(() => {});
    }
  }

  async fetchBody(mailboxPath: string, providerId: string): Promise<ProviderBody> {
    const uid = parseInt(providerId, 10);
    if (Number.isNaN(uid)) throw new Error("Invalid IMAP message id");
    const imap = this.connectImap();
    try {
      await imap.connect();
      await imap.select(mailboxPath);
      const raw = await imap.fetchRawByUid(uid);
      return await this.parseBody(raw);
    } finally {
      await imap.close().catch(() => {});
    }
  }

  async fetchAttachment(
    mailboxPath: string,
    providerId: string,
    partNumber: string | null,
  ): Promise<ProviderAttachment> {
    const uid = parseInt(providerId, 10);
    if (Number.isNaN(uid)) throw new Error("Invalid IMAP message id");
    // The handle is the index of the attachment within the message's parsed
    // attachment list (captured at body-fetch time). We re-fetch the raw
    // message on demand and re-parse it — nothing is stored in our infra.
    const idx = parseInt(partNumber ?? "", 10);
    if (Number.isNaN(idx) || idx < 0) throw new Error("Missing attachment part number");
    const imap = this.connectImap();
    try {
      await imap.connect();
      await imap.select(mailboxPath);
      const raw = await imap.fetchRawByUid(uid);
      const { default: PostalMime } = await import("postal-mime");
      const email = await PostalMime.parse(raw);
      const a = (email.attachments ?? [])[idx];
      if (!a || !a.content) throw new Error("Attachment not found in message");
      const data =
        a.content instanceof Uint8Array
          ? a.content
          : new Uint8Array(a.content instanceof ArrayBuffer ? a.content : asciiBytes(a.content));
      return {
        filename: a.filename ?? null,
        mimeType: a.mimeType ?? "application/octet-stream",
        data,
      };
    } finally {
      await imap.close().catch(() => {});
    }
  }

  private async parseBody(raw: Uint8Array): Promise<ProviderBody> {
    // MIME parsing happens in the sync/parse layer to keep this adapter slim;
    // but we need the structured body here. Import PostalMime lazily.
    const { default: PostalMime } = await import("postal-mime");
    const email = await PostalMime.parse(raw);
    // Map attachments to their MIME part numbers (IMAP BODY[part] addresses):
    // postal-mime exposes a part number on each attachment when parsing raw
    // bytes — fall back to the attachment index if unavailable.
    const attachments = (email.attachments ?? []).map((a, i) => ({
      filename: a.filename ?? null,
      mimeType: a.mimeType ?? "application/octet-stream",
      size: a.content ? byteLength(a.content) : 0,
      isInline: a.disposition === "inline" || !!a.contentId || !!a.related,
      contentId: a.contentId ?? null,
      contentBase64: a.content ? toBase64(a.content) : null,
      // The deterministic index within the parsed attachment list; used to
      // re-fetch this part directly from the provider on download.
      partNumber: String(i),
      disposition: (a.disposition === "attachment" || a.disposition === "inline"
        ? a.disposition
        : null) as "attachment" | "inline" | null,
    }));
    return {
      html: email.html ?? null,
      text: email.text ?? null,
      attachments,
    };
  }

  async setFlags(
    mailboxPath: string,
    providerIds: string[],
    flags: { read?: boolean; starred?: boolean },
  ): Promise<void> {
    const uids = providerIds.map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
    if (uids.length === 0) return;
    const imap = this.connectImap();
    try {
      await imap.connect();
      await imap.select(mailboxPath);
      await imap.setFlags(uids, flags);
    } finally {
      await imap.close().catch(() => {});
    }
  }

  async move(mailboxPath: string, providerIds: string[], targetMailboxPath: string): Promise<void> {
    const uids = providerIds.map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
    if (uids.length === 0) return;
    const imap = this.connectImap();
    try {
      await imap.connect();
      await imap.select(mailboxPath);
      try {
        await imap.move(uids, targetMailboxPath);
      } catch (err) {
        // MOVE unsupported: copy then delete.
        if (err instanceof ImapError) {
          await imap.copy(uids, targetMailboxPath);
          await imap.delete(uids);
          return;
        }
        throw err;
      }
    } finally {
      await imap.close().catch(() => {});
    }
  }

  async delete(mailboxPath: string, providerIds: string[]): Promise<void> {
    const uids = providerIds.map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
    if (uids.length === 0) return;
    const imap = this.connectImap();
    try {
      await imap.connect();
      await imap.select(mailboxPath);
      await imap.delete(uids);
    } finally {
      await imap.close().catch(() => {});
    }
  }

  async send(opts: SendOptions): Promise<void> {
    const recipients = [...opts.to, ...(opts.cc ?? []), ...(opts.bcc ?? [])];
    await smtpSend(
      {
        host: this.transport.smtpHost,
        port: this.transport.smtpPort,
        secure: this.transport.smtpSecure,
        username: this.creds.username,
        password: this.creds.password,
        from: opts.from,
      },
      opts.rawMessage,
      recipients,
    );
  }
}

function toBase64(content: Uint8Array | ArrayBuffer | string): string {
  if (typeof content === "string") return btoa(content);
  return bytesToBase64(content);
}

function bytesToBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
}

/** Raw bytes of a plain ASCII/UTF-8 string (for textual attachment parts). */
function asciiBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function byteLength(content: Uint8Array | ArrayBuffer | string): number {
  if (typeof content === "string") return content.length;
  return content.byteLength;
}
