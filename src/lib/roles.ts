// Localized labels for canonical mailbox roles. Special folders (Inbox, Sent,
// Drafts, …) are identified by their role — which the backend detects via the
// IMAP SPECIAL-USE attributes (and the reserved INBOX name) — so they can be
// shown in the app's language regardless of the provider's own folder name.
// Unknown roles return null so callers fall back to the provider's folder name.
import type { MailboxRole } from "@shared/constants";
import { t } from "./i18n";

/** Localized label for a known folder role, or null for unrecognized roles. */
export function roleLabel(role: MailboxRole | undefined | null): string | null {
  if (!role) return null;
  switch (role) {
    case "inbox":
      return t("mailbox.roleInbox");
    case "all":
      return t("mailbox.roleAllMail");
    case "sent":
      return t("mailbox.roleSent");
    case "drafts":
      return t("mailbox.roleDrafts");
    case "archive":
      return t("mailbox.roleArchive");
    case "spam":
      return t("mailbox.roleSpam");
    case "trash":
      return t("mailbox.roleTrash");
    default:
      return null;
  }
}
