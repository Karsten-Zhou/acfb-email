// Worker environment bindings and vars.
export interface Env {
  // D1 database binding
  DB: D1Database;
  // Secrets
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_GITHUB_USER_ID: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  // Vars
  APP_URL: string;
  SESSION_DAYS: string;
  SYNC_FETCH_LIMIT: string;
  SYNC_TIMEOUT_MS: string;
}
