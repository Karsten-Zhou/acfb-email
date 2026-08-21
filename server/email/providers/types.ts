// Provider adapter contract. The rest of the application (sync, routes) only
// ever talks to this interface, so adding Gmail/Microsoft/POP3 later is a
// matter of implementing this interface.

import type { ProviderType } from "@shared/constants";

export interface ProviderMailbox {
  name: string; // display/path name
  delimiter: string | null;
  flags: string[];
}

export interface ProviderAddress {
  name: string | null;
  address: string | null;
}

export interface ProviderMessage {
  remoteUid: number;
  messageId: string | null;
  subject: string | null;
  from: ProviderAddress | null;
  to: ProviderAddress[];
  cc: ProviderAddress[];
  date: string | null;
  internalDate: string | null;
  flags: string[];
  size: number | null;
}

export interface ProviderFetchResult {
  messages: ProviderMessage[];
  // Highest UID seen during this fetch (for incremental sync cursor).
  highestUid: number;
  // UIDVALIDITY of the mailbox (to detect a mailbox reset).
  uidValidity: number | null;
  // Total/EXISTS count in mailbox after select.
  total: number | null;
}

export interface ProviderBody {
  html: string | null;
  text: string | null;
  attachments: {
    filename: string | null;
    mimeType: string;
    size: number;
    isInline: boolean;
    contentId: string | null;
    contentBase64: string | null; // base64 content (small attachments)
  }[];
}

export interface ProviderSyncOptions {
  // If set, only fetch messages with UID > this.
  sinceUid?: number;
  fetchLimit?: number;
}

export interface SendOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  rawMessage: Uint8Array; // pre-built MIME (escaped) — provider adapters may
  // instead build their own; the IMAP/SMTP adapter just relays this.
  inReplyTo?: string | null;
  references?: string[];
}

export interface IEmailProvider {
  readonly type: ProviderType;

  /** Verify credentials and retrieve basic info. Should throw on failure. */
  testConnection(): Promise<{ ok: true }>;

  /**
   * List mailboxes. Returns provider mailboxes and their role mapping hint.
   */
  listMailboxes(): Promise<ProviderMailbox[]>;

  /**
   * Incrementally sync a single mailbox folder. Returns new/changed messages.
   */
  syncMailbox(
    mailboxPath: string,
    options: ProviderSyncOptions,
  ): Promise<ProviderFetchResult>;

  /** Fetch the full body & attachments of a message by UID. */
  fetchBody(mailboxPath: string, uid: number): Promise<ProviderBody>;

  /** Set flags (read/starred) for a set of UIDs in a mailbox. */
  setFlags(mailboxPath: string, uids: number[], flags: { read?: boolean; starred?: boolean }): Promise<void>;

  /** Move UIDs to another mailbox. */
  move(mailboxPath: string, uids: number[], targetMailboxPath: string): Promise<void>;

  /** Delete UIDs from a mailbox. */
  delete(mailboxPath: string, uids: number[]): Promise<void>;

  /** Send a message. */
  send(opts: SendOptions): Promise<void>;
}
