// OAuth provider configurations (Google / Microsoft).
import type { Env } from "../env";
import type { OAuthProviderConfig } from "./client";

export function googleConfig(env: Env): OAuthProviderConfig {
  return {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    scopes: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
    ],
    redirectUri: () => `${env.APP_URL.replace(/\/$/, "")}/api/oauth/google/callback`,
  };
}

export function microsoftConfig(env: Env): OAuthProviderConfig {
  return {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientId: env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
    scopes: ["User.Read", "Mail.ReadWrite", "offline_access"],
    redirectUri: () => `${env.APP_URL.replace(/\/$/, "")}/api/oauth/microsoft/callback`,
  };
}

export function configFor(
  env: Env,
  provider: "google" | "microsoft",
): OAuthProviderConfig {
  return provider === "google" ? googleConfig(env) : microsoftConfig(env);
}