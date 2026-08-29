import type { MailboxRole } from "@shared/constants";

/**
 * Map an IMAP mailbox to our canonical role using the server-declared
 * SPECIAL-USE attributes (RFC 6154). Folders without a SPECIAL-USE attribute
 * map to "other". INBOX is the one reserved mailbox name (RFC 3501), so it
 * maps by name.
 */
export function roleFromImapName(name: string, flags: string[]): MailboxRole {
  if (flags.includes("\\All")) return "all";
  if (flags.includes("\\Sent")) return "sent";
  if (flags.includes("\\Drafts")) return "drafts";
  if (flags.includes("\\Trash")) return "trash";
  if (flags.includes("\\Junk")) return "spam";
  if (flags.includes("\\Archive")) return "archive";
  if (flags.includes("\\Inbox")) return "inbox";

  if (name.toUpperCase() === "INBOX") return "inbox";

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
