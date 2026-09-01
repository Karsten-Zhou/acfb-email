// VAPID configuration for Web Push (RFC 8292). The private key is read only
// here (server-side) and signed into the JWT `Authorization` header for each
// request; the public key is served to the browser for `pushManager.subscribe`.
import webpush from "web-push";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Read VAPID credentials from Worker bindings, or null when unconfigured. */
export function getVapidConfig(env: Env): VapidConfig | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || "mailto:acfb-email@localhost",
  };
}

/** Configure the global web-push VAPID details, if valid keys are present. */
export function configureWebPush(env: Env): boolean {
  const vapid = getVapidConfig(env);
  if (!vapid) return false;
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return true;
}
