// Provider data shapes shared between the ImapProvider adapter (server/email/)
// and the sync/routes layers.

import type { MailboxRole } from "@shared/constants";

export interface ProviderMailbox {
  name: string; // display/path name
  delimiter: string | null;
  flags: string[];
  /** Canonical role when the provider can identify it reliably via the IMAP
   *  SPECIAL-USE attributes (and the reserved INBOX name) — independent of
   *  the folder's display name/locale. */
  role?: MailboxRole;
}

export interface ProviderAddress {
  name: string | null;
  address: string | null;
}

export interface ProviderMessage {
  /** Stable provider-side id: the IMAP UID (numeric, as string). Used to
   *  perform operations on the message. */
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
  /** Attachment presence, only known once the body is fetched. */
  hasAttachments?: boolean;
}

export interface ProviderFetchResult {
  messages: ProviderMessage[];
  /**
   * Max UID included in `messages` this pass. The sync layer advances the
   * cursor only after every message through this UID is durably applied — it
   * is NEVER the server's max UID when the fetch was truncated.
   */
  highestUid: number;
  /**
   * Complete authoritative UID set currently in the mailbox (a full
   * `UID SEARCH 1:*`), NOT merely the UIDs included in `messages`. The sync
   * layer deletes local locations whose UID is absent here — if this were ever
   * changed to a partial set, deletion reconciliation would mass-delete rows.
   */
  currentUids: number[];
  /** UIDVALIDITY of the mailbox (to detect a mailbox reset). */
  uidValidity: number | null;
  /** Total/EXISTS count in mailbox after select. */
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
    /** Provider-side handle for the attachment part (IMAP part number). */
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
  rawMessage: Uint8Array; // pre-built MIME — the adapter relays this as-is
}

/** Draft content written to the provider's Drafts folder on save. */
export interface SaveDraftOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  rawMessage: Uint8Array; // pre-built MIME
}
