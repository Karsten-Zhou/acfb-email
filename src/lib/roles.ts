// Localized labels for canonical mailbox roles. Special folders (Inbox, Sent,
// Drafts, …) are identified by their role — which the backend detects via the
// IMAP SPECIAL-USE attributes (and the reserved INBOX name) — so they can be
// shown in the app's language regardless of the provider's own folder name.
// Unknown roles return null so callers fall back to the provider's folder name.
import type { MailboxRole } from "@shared/constants";
import { t, type MessageKey } from "./i18n";

const ROLE_LABEL_KEY: Partial<Record<MailboxRole, MessageKey>> = {
  inbox: "mailbox.roleInbox",
  all: "mailbox.roleAllMail",
  sent: "mailbox.roleSent",
  drafts: "mailbox.roleDrafts",
  archive: "mailbox.roleArchive",
  spam: "mailbox.roleSpam",
  trash: "mailbox.roleTrash",
};

/** Localized label for a known folder role, or null for unrecognized roles. */
export function roleLabel(role: MailboxRole | undefined | null): string | null {
  if (!role) return null;
  const key = ROLE_LABEL_KEY[role];
  return key ? t(key) : null;
}
