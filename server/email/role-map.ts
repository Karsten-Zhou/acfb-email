import type { MailboxRole } from "@shared/constants";

/**
 * Map an IMAP mailbox name (+ delimiter + flags) to our canonical role.
 * Order matters: more specific checks first.
 */
export function roleFromImapName(name: string, flags: string[]): MailboxRole {
  const upper = name.toUpperCase();
  const path = upper;

  if (path === "INBOX") return "inbox";
  if (/\bSPAM\b/.test(path) || /\bJUNK\b/.test(path)) return "spam";
  if (/\bTRASH\b/.test(path) || /\bDELETED\b/.test(path) || /\bBIN\b/.test(path)) return "trash";
  if (/\bDRAFTS?\b/.test(path)) return "drafts";
  if (/\bSENT\b/.test(path) || /\bOUTBOX\b/.test(path) || /\bSENT MAIL\b/.test(path)) return "sent";
  // "All Mail" (Gmail virtual folder) behaves like an "all" view, not an
  // archive. Check before generic ARCHIVE.
  if (/(^|\/)ALL MAIL$/i.test(path) || path === "[GMAIL]/ALL MAIL") return "all";
  if (/\bARCHIVE\b/.test(path)) return "archive";
  if (path === "[GMAIL]/ALL MAIL") return "all";

  // Provider-specific
  if (flags.includes("\\All")) return "all";
  if (flags.includes("\\Sent")) return "sent";
  if (flags.includes("\\Drafts")) return "drafts";
  if (flags.includes("\\Trash")) return "trash";
  if (flags.includes("\\Junk")) return "spam";
  if (flags.includes("\\Archive")) return "archive";
  if (flags.includes("\\Inbox")) return "inbox";

  return "other";
}

/** Given a role, produce a default sort order for the sidebar. */
export function roleSortOrder(role: MailboxRole): number {
  switch (role) {
    case "inbox":
      return 0;
    case "all":
      return 1;
    case "sent":
      return 2;
    case "drafts":
      return 3;
    case "archive":
      return 4;
    case "spam":
      return 5;
    case "trash":
      return 6;
    default:
      return 100;
  }
}
