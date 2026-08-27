// Generic IMAP/SMTP provider adapter built on `imapflow`. Decouples protocol
// work from the provider interface so Gmail/Microsoft can be added without
// touching sync logic.

import { ImapFlow, AuthenticationFailure } from "imapflow";
import { smtpSend } from "../smtp/client";
import { roleFromImapName } from "./role-map";
import type {
  IEmailProvider,
  ProviderAddress,
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

  private createClient(): ImapFlow {
    return new ImapFlow({
      host: this.transport.imapHost,
      port: this.transport.imapPort,
      secure: this.transport.imapSecure,
      servername: this.transport.imapHost,
      auth: { user: this.creds.username, pass: this.creds.password },
      // Workerd's compressed stream chain drops large responses (e.g. UID
      // SEARCH), so COMPRESS=DEFLATE stays off.
      disableCompression: true,
      logger: false,
    });
  }

  /** Open a fresh connection, run `fn`, then log out. */
  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = this.createClient();
    try {
      await client.connect();
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  async testConnection(): Promise<{ ok: true }> {
    const client = this.createClient();
    try {
      await client.connect();
      await client.logout();
      return { ok: true };
    } catch (err) {
      // Surface the server's rejection reason (e.g. "Basic authentication is
      // disabled", app-password required) to the test-connection UI.
      throw toTestError(err);
    } finally {
      client.close();
    }
  }

  async listMailboxes(): Promise<ProviderMailbox[]> {
    return this.withClient(async (client) => {
      const boxes = await client.list();
      return boxes.map((box) => ({
        name: box.path,
        delimiter: box.delimiter ?? null,
        flags: [...box.flags],
        role: roleFromImapName(box.path, [...box.flags]),
      }));
    });
  }

  async syncMailbox(
    mailboxPath: string,
    options: ProviderSyncOptions,
  ): Promise<ProviderFetchResult> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        let uids: number[];
        if (options.sinceUid && options.sinceUid > 0) {
          uids = (await client.search({ uid: `${options.sinceUid + 1}:*` }, { uid: true })) || [];
        } else {
          const all = (await client.search({ uid: "1:*" }, { uid: true })) || [];
          const limit = options.fetchLimit ?? 200;
          uids = all.slice(-limit); // newest `limit`
        }
        const messages = await this.fetchEnvelopes(client, uids);
        const mailbox = client.mailbox;
        return {
          messages,
          highestUid: uids.length ? Math.max(...uids) : 0,
          uidValidity:
            mailbox && typeof mailbox.uidValidity === "bigint" ? Number(mailbox.uidValidity) : null,
          total: mailbox ? mailbox.exists : null,
        };
      } finally {
        lock.release();
      }
    });
  }

  async fetchOlder(mailboxPath: string, options: ProviderSyncOptions): Promise<ProviderPageResult> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        if (!options.beforeUid || options.beforeUid <= 1) {
          return { messages: [], hasMore: false };
        }
        const all =
          (await client.search({ uid: `1:${options.beforeUid - 1}` }, { uid: true })) || [];
        const limit = options.fetchLimit ?? 50;
        const uids = all.slice(-limit); // the `limit` most recent of those older than the cursor
        if (uids.length === 0) return { messages: [], hasMore: false };
        const messages = await this.fetchEnvelopes(client, uids);
        return {
          messages,
          // If we got a full page, there are (likely) more even older messages.
          hasMore: uids.length === limit && all.length > limit,
        };
      } finally {
        lock.release();
      }
    });
  }

  async fetchBody(mailboxPath: string, providerId: string): Promise<ProviderBody> {
    const uid = parseInt(providerId, 10);
    if (Number.isNaN(uid)) throw new Error("Invalid IMAP message id");
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        const raw = await this.fetchSource(client, uid);
        return await this.parseBody(raw);
      } finally {
        lock.release();
      }
    });
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
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        const raw = await this.fetchSource(client, uid);
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
        lock.release();
      }
    });
  }

  async setFlags(
    mailboxPath: string,
    providerIds: string[],
    flags: { read?: boolean; starred?: boolean },
  ): Promise<void> {
    const uids = providerIds.map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
    if (uids.length === 0) return;
    await this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        if (flags.read !== undefined) {
          if (flags.read) await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
          else await client.messageFlagsRemove(uids, ["\\Seen"], { uid: true });
        }
        if (flags.starred !== undefined) {
          if (flags.starred) await client.messageFlagsAdd(uids, ["\\Flagged"], { uid: true });
          else await client.messageFlagsRemove(uids, ["\\Flagged"], { uid: true });
        }
      } finally {
        lock.release();
      }
    });
  }

  async move(mailboxPath: string, providerIds: string[], targetMailboxPath: string): Promise<void> {
    const uids = providerIds.map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
    if (uids.length === 0) return;
    await this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        await client.messageMove(uids, targetMailboxPath, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async delete(mailboxPath: string, providerIds: string[]): Promise<void> {
    const uids = providerIds.map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
    if (uids.length === 0) return;
    await this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        await client.messageDelete(uids, { uid: true });
      } finally {
        lock.release();
      }
    });
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

  /** Append the draft MIME into the provider's Drafts folder. */
  async saveDraft(opts: SaveDraftOptions): Promise<void> {
    await this.withClient(async (client) => {
      const boxes = await client.list();
      const drafts =
        boxes.find((b) => roleFromImapName(b.path, [...b.flags]) === "drafts") ??
        boxes.find((b) => b.path.toUpperCase() === "DRAFTS");
      await client.append(drafts?.path ?? "Drafts", opts.rawMessage, ["\\Drafts"]);
    });
  }

  private async fetchEnvelopes(client: ImapFlow, uids: number[]): Promise<ProviderMessage[]> {
    if (uids.length === 0) return [];
    const messages: ProviderMessage[] = [];
    for await (const msg of client.fetch(
      uids,
      { uid: true, envelope: true, flags: true, size: true, internalDate: true },
      { uid: true },
    )) {
      messages.push({
        providerId: String(msg.uid),
        remoteUid: msg.uid,
        messageId: msg.envelope?.messageId ?? null,
        subject: msg.envelope?.subject ?? null,
        from: toProviderAddress(msg.envelope?.from?.[0]),
        to: (msg.envelope?.to ?? []).map(toProviderAddress),
        cc: (msg.envelope?.cc ?? []).map(toProviderAddress),
        date: msg.envelope?.date ? toIsoString(msg.envelope.date) : null,
        internalDate: toIsoString(msg.internalDate),
        flags: [...(msg.flags ?? [])],
        size: msg.size ?? null,
      });
    }
    return messages;
  }

  private async fetchSource(client: ImapFlow, uid: number): Promise<Uint8Array> {
    const msg = await client.fetchOne(uid, { source: true }, { uid: true });
    if (!msg) throw new Error("Message not found");
    return toUint8Array(msg.source);
  }

  private async parseBody(raw: Uint8Array): Promise<ProviderBody> {
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
}

function toProviderAddress(a?: { name?: string; address?: string }): ProviderAddress {
  return { name: a?.name ?? null, address: a?.address ?? null };
}

function toIsoString(d: Date | string | undefined): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function toTestError(err: unknown): Error {
  if (err instanceof AuthenticationFailure) {
    const e = err as AuthenticationFailure & { responseText?: string; response?: string };
    const detail = e.responseText || e.response || err.message;
    return new Error(detail);
  }
  return err instanceof Error ? err : new Error(String(err));
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

function toUint8Array(buf: Uint8Array | undefined): Uint8Array {
  if (!buf) throw new Error("Message not found");
  return buf;
}
