// Shared constant values used across client and server.

export const PROVIDER_TYPES = ["imap", "gmail", "microsoft", "pop3"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const ACCOUNT_STATES = [
  "healthy",
  "running", // transient: a sync is in progress
  "unavailable",
  "auth_required",
  "invalid_config",
  "paused",
] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export const MAILBOX_ROLES = [
  "inbox",
  "sent",
  "drafts",
  "trash",
  "archive",
  "spam",
  "all",
  "other",
] as const;
export type MailboxRole = (typeof MAILBOX_ROLES)[number];
