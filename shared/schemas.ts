import { z } from "zod";
import { ACCOUNT_STATES, MAILBOX_ROLES, PROVIDER_TYPES } from "./constants";

// ---------------------------------------------------------------
// Page-facing DTOs (what the client API returns/accepts).
// These are hand-derived from validated DB rows; never trust client
// input directly except where a schema is applied.
// ---------------------------------------------------------------

export const AddressSchema = z.object({
  name: z.string().nullable(),
  address: z.string(),
});

export const RecipientSchema = z.object({
  type: z.enum(["to", "cc", "bcc"]),
  name: z.string().nullable(),
  address: z.string(),
});

export const MailboxSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  role: z.enum(MAILBOX_ROLES),
  providerPath: z.string().nullable(),
  delimiter: z.string().nullable(),
  totalMessages: z.number().int().nonnegative().nullable(),
  unseenMessages: z.number().int().nonnegative().nullable(),
});

export const AttachmentMetaSchema = z.object({
  id: z.string(),
  filename: z.string().nullable(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  isInline: z.boolean(),
  contentId: z.string().nullable(),
  /** RFC2183 disposition: "attachment" | "inline" (nullable). */
  disposition: z.string().nullable(),
});

/** A provider-side attachment handle, used to fetch binary content on demand. */
export const AttachmentDownloadSchema = z.object({
  /** The message's provider id (IMAP UID / Gmail id / Graph id). */
  providerMessageId: z.string(),
  /** The attachment's identifier within the provider (part number, Gmail attachmentId, Graph id). */
  providerAttachmentId: z.string().nullable(),
  /** Raw MIME part identifier for IMAP (e.g. "1.2") or null for REST providers. */
  partNumber: z.string().nullable(),
});

export const MessageSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  mailboxId: z.string(),
  remoteUid: z.number().int().nullable(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  from: AddressSchema.nullable(),
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  bcc: z.array(AddressSchema),
  date: z.string(),
  receivedAt: z.string(),
  isRead: z.boolean(),
  isStarred: z.boolean(),
  hasAttachments: z.boolean(),
  maybeThreadId: z.string().nullable(),
});

export const MessageDetailSchema = MessageSchema.extend({
  html: z.string().nullable(),
  text: z.string().nullable(),
  attachments: z.array(AttachmentMetaSchema),
  remoteUid: z.number().int().nullable(),
  remoteMessageId: z.string().nullable(),
});

export const AccountSummarySchema = z.object({
  id: z.string(),
  provider: z.enum(PROVIDER_TYPES),
  name: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  state: z.enum(ACCOUNT_STATES),
  stateMessage: z.string().nullable(),
  createdAt: z.string(),
  lastSyncedAt: z.string().nullable(),
  /** User-controlled position in the account list (lower = earlier). */
  sortOrder: z.number().int().nonnegative(),
});

export const AccountDetailSchema = AccountSummarySchema.extend({
  imapHost: z.string().nullable(),
  imapPort: z.number().int().nullable(),
  smtpHost: z.string().nullable(),
  smtpPort: z.number().int().nullable(),
  useTls: z.boolean().nullable(),
  syncEnabled: z.boolean(),
});

export const UserSchema = z.object({
  id: z.string(),
  githubId: z.number().int(),
  githubLogin: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

export const SyncStatusSchema = z.object({
  state: z.enum(["idle", "running", "error"]),
  message: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

// --- Input schemas (client -> server) ---

export const AddAccountInputSchema = z.object({
  provider: z.literal("imap"),
  name: z.string().min(1).max(100),
  email: z.string().email().max(254),
  displayName: z.string().max(100).optional().default(""),
  imapHost: z.string().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535).optional().default(993),
  imapSecure: z.boolean().optional().default(true),
  smtpHost: z.string().min(1).max(255),
  smtpPort: z.number().int().min(1).max(65535).optional().default(465),
  smtpSecure: z.boolean().optional().default(true),
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
});

export const TestConnectionInputSchema = AddAccountInputSchema;

export const SendAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional().default("application/octet-stream"),
  /** Base64-encoded file content (assembled client-side; small files only). */
  base64: z.string().min(1).max(10_000_000),
  size: z.number().int().nonnegative().optional().default(0),
});

export const SendMessageInputSchema = z.object({
  accountId: z.string().min(1),
  to: z.array(z.string().email()).min(1).max(50),
  cc: z.array(z.string().email()).max(50).optional().default([]),
  bcc: z.array(z.string().email()).max(50).optional().default([]),
  subject: z.string().max(998).optional().default(""),
  html: z.string().max(2_000_000).optional().default(""),
  text: z.string().max(2_000_000).optional().default(""),
  inReplyTo: z.string().nullable().optional().default(null),
  references: z.array(z.string()).optional().default([]),
  attachments: z.array(z.string()).optional().default([]), // attachment ids
  /** New files to attach to the outgoing message (client-assembled). */
  newAttachments: z.array(SendAttachmentSchema).optional().default([]),
});

export const UpdateFlagsInputSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
});

export const MoveMessagesInputSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  targetMailboxId: z.string().min(1),
});

export const DeleteMessagesInputSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
});

export const DraftInputSchema = z.object({
  id: z.string().optional(),
  accountId: z.string().nullable().optional(),
  to: z.array(z.string()).optional().default([]),
  cc: z.array(z.string()).optional().default([]),
  bcc: z.array(z.string()).optional().default([]),
  subject: z.string().max(998).optional().default(""),
  html: z.string().max(2_000_000).optional().default(""),
  text: z.string().max(2_000_000).optional().default(""),
});
