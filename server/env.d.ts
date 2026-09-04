// Optional secrets can't be typed accurately by `wrangler types`, so we suppressed
// them in wrangler.jsonc and typed them here instead.
interface Env {
  CREDENTIAL_ENCRYPTION_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ACCESS_JWKS?: string;
  ACCESS_AUD?: string;
}
