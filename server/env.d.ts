// The app env, derived from wrangler's generated `GeneratedEnv`. Secrets live
// only in `.env` locally / Worker secrets in production — untracked and unknown
// to type generation — so every one is declared here, never inherited from the
// generated type. Optional = a provider/feature may be unconfigured; the
// encryption key is always required.
type OptionalSecretKeys =
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "MICROSOFT_CLIENT_ID"
  | "MICROSOFT_CLIENT_SECRET"
  | "VAPID_PUBLIC_KEY"
  | "VAPID_PRIVATE_KEY"
  | "VAPID_SUBJECT"
  | "ACCESS_JWKS"
  | "ACCESS_AUD";
type RequiredSecretKeys = "CREDENTIAL_ENCRYPTION_KEY";

type Env = Omit<GeneratedEnv, OptionalSecretKeys | RequiredSecretKeys> &
  Partial<Pick<GeneratedEnv, OptionalSecretKeys>> &
  Record<RequiredSecretKeys, string>;
