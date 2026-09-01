// Payload for account-sync jobs enqueued to the SYNC_QUEUE. A job without a
// mailboxId syncs every mailbox in the account; with one, it retries that
// single mailbox.
export interface SyncMessage {
  accountId: string;
  mailboxId?: string;
}

// Worker environment bindings and vars.
export interface Env {
  // D1 database binding
  DB: D1Database;
  // Queue binding for background account syncs (consumer in server/index.ts)
  SYNC_QUEUE: Queue<SyncMessage>;
  // Secrets
  CREDENTIAL_ENCRYPTION_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  // Web Push VAPID: public key is a var (served to the browser); the private
  // key is a secret (never exposed to the client).
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  // Vars
  SYNC_FETCH_LIMIT: string;
  SYNC_TIMEOUT_MS: string;
}
