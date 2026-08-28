// Convenience inferred types derived from the Zod schemas.
import type { z } from "zod";
import * as S from "./schemas";

export type Address = z.infer<typeof S.AddressSchema>;
export type Recipient = z.infer<typeof S.RecipientSchema>;
export type Mailbox = z.infer<typeof S.MailboxSchema>;
export type AttachmentMeta = z.infer<typeof S.AttachmentMetaSchema>;
export type AttachmentDownload = z.infer<typeof S.AttachmentDownloadSchema>;
export type Message = z.infer<typeof S.MessageSchema>;
export type MessageDetail = z.infer<typeof S.MessageDetailSchema>;
export type AccountSummary = z.infer<typeof S.AccountSummarySchema>;
export type AccountDetail = z.infer<typeof S.AccountDetailSchema>;
export type SyncStatus = z.infer<typeof S.SyncStatusSchema>;
export type AddAccountInput = z.infer<typeof S.AddAccountInputSchema>;
export type SendMessageInput = z.infer<typeof S.SendMessageInputSchema>;
export type SendAttachment = z.infer<typeof S.SendAttachmentSchema>;
