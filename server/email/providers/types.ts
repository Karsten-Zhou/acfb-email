// Provider adapter contract. The rest of the application (sync, routes) only
// ever talks to this interface, so adding Gmail/Microsoft/POP3 later is a
// matter of implementing this interface.

import type { MailboxRole, ProviderType } from "@shared/constants";

export interface ProviderMailbox {
  name: string; // display/path name
  delimiter: string | null;
  flags: string[];
  /** Canonical role when the provider can identify it reliably (IMAP
   *  SPECIAL-USE flags, Gmail system label, Graph well-known folder name) —
   *  independent of the folder's display name/locale. */
  role?: MailboxRole;
}

export interface ProviderAddress {
  name: string | null;
  address: string | null;
}

export interface ProviderMessage {
  /** Stable provider-side id: IMAP UID (numeric as string), Gmail message id,
   *  Outlook message id. Used to perform operations on the message. */
  providerId: string;
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
  /** Provider-reported attachment presence (REST providers); IMAP unknown. */
  hasAttachments?: boolean;
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
    /** Provider-side handle for the attachment part (IMAP part number, Gmail attachmentId, Graph attachment id). */
    partNumber: string | null;
    disposition: "attachment" | "inline" | null;
  }[];
}

/** Binary attachment bytes + metadata, returned by the download route. */
export interface ProviderAttachment {
  filename: string | null;
  mimeType: string;
  data: Uint8Array;
}

export interface ProviderSyncOptions {
  // If set, only fetch messages with UID > this.
  sinceUid?: number;
  // If set, only fetch messages with UID < this (older page).
  beforeUid?: number;
  // If set, only fetch messages received before this epoch-ms (older page,
  // for date-based REST providers like Graph).
  beforeDate?: number;
  fetchLimit?: number;
}

/** Result of fetching an older page (used by load-older). */
export interface ProviderPageResult {
  messages: ProviderMessage[];
  // Whether more older messages exist upstream.
  hasMore: boolean;
}

export interface SendOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  rawMessage: Uint8Array; // pre-built MIME — IMAP/SMTP adapter relays this
  html?: string; // for REST providers (Gmail/Graph) that build their own body
  text?: string;
  inReplyTo?: string | null;
  references?: string[];
}

/** Draft content written to the provider's Drafts folder on save. */
export interface SaveDraftOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  rawMessage: Uint8Array; // pre-built MIME
  html?: string; // for REST providers (Gmail/Graph) that build their own body
  text?: string;
}

export interface IEmailProvider {
  readonly type: ProviderType;

  /** Verify credentials and retrieve basic info. Should throw on failure. */
  testConnection(): Promise<{ ok: true }>;

  /**
   * List mailboxes. Returns provider mailboxes (paths).
   */
  listMailboxes(): Promise<ProviderMailbox[]>;

  /**
   * Incrementally sync a single mailbox folder. Returns new/changed messages.
   */
  syncMailbox(mailboxPath: string, options: ProviderSyncOptions): Promise<ProviderFetchResult>;

  /** Fetch an older page of messages (below `beforeUid`). */
  fetchOlder(mailboxPath: string, options: ProviderSyncOptions): Promise<ProviderPageResult>;

  /** Fetch the full body & attachments of a message. */
  fetchBody(mailboxPath: string, providerMessageId: string): Promise<ProviderBody>;

  /**
   * Fetch a single attachment's binary content directly from the provider
   * (never stored in Cloudflare infra). `partNumber` is the provider-specific
   * attachment handle captured at body-fetch time.
   */
  fetchAttachment(
    mailboxPath: string,
    providerMessageId: string,
    partNumber: string | null,
  ): Promise<ProviderAttachment>;

  /** Set flags (read/starred) for a set of provider message ids. */
  setFlags(
    mailboxPath: string,
    providerMessageIds: string[],
    flags: { read?: boolean; starred?: boolean },
  ): Promise<void>;

  /** Move provider message ids to another mailbox. */
  move(mailboxPath: string, providerMessageIds: string[], targetMailboxPath: string): Promise<void>;

  /** Delete provider message ids from a mailbox. */
  delete(mailboxPath: string, providerMessageIds: string[]): Promise<void>;

  /** Send a message. */
  send(opts: SendOptions): Promise<void>;

  /** Save a draft into the provider's Drafts folder. */
  saveDraft(opts: SaveDraftOptions): Promise<void>;
}
