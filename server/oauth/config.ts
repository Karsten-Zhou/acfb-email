// OAuth provider configurations (Google / Microsoft). Tokens are used for
// IMAP/SMTP access (XOAUTH2).
import type { OAuthProviderConfig } from "./client";
import { makeRedirectUri } from "./client";

export function googleConfig(env: Env, baseUrl: string): OAuthProviderConfig {
  return {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    scopes: [
      // Full Gmail access over IMAP/SMTP. Google only accepts this scope for
      // OAuth-based IMAP/SMTP/POP access (XOAUTH2).
      "https://mail.google.com/",
      "openid",
      "email",
      "profile",
    ],
    redirectUri: makeRedirectUri(baseUrl, "google"),
  };
}

export function microsoftConfig(env: Env, baseUrl: string): OAuthProviderConfig {
  return {
    // Personal (consumer) Microsoft accounts — matches an Entra app whose
    // "Supported account types" is "Personal Microsoft accounts only".
    // (Use "/common/" for an "All" audience app, "/organizations/" for
    //  work/school only. The /common/ endpoint errors on Consumer-audience
    //  apps with invalid_request.)
    authorizeUrl: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    clientId: env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
    // Outlook.com has password auth disabled, so IMAP and SMTP both require
    // OAuth2 (XOAUTH2). IMAP.AccessAsUser.All covers read/flag/move/delete;
    // SMTP.Send covers sending (separate scope). The OIDC scopes (openid,
    // profile, email) provide the owner's identity via the ID token;
    // offline_access keeps the refresh token.
    scopes: [
      "openid",
      "profile",
      "email",
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
    ],
    // The token request must list scopes from a single resource, so the
    // access token is minted for the Outlook mail endpoints only.
    tokenScopes: [
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
    ],
    redirectUri: makeRedirectUri(baseUrl, "microsoft"),
  };
}

export function configFor(
  env: Env,
  baseUrl: string,
  provider: "google" | "microsoft",
): OAuthProviderConfig {
  return provider === "google" ? googleConfig(env, baseUrl) : microsoftConfig(env, baseUrl);
}
