// Browser push-notification management helpers. Framework-free and testable:
// push/notification browser globals are accessed through the `window`/`navigator`
// APIs directly, so the module is inert outside a browser. Permission is only
// ever requested from an explicit user action (the Settings toggle), never
// automatically on page load.
import type { PushSubscriptionInput } from "@shared/types";

export const SERVICE_WORKER_PATH = "/sw.js";

export type PushStatus =
  "unsupported" | "idle" | "permission-denied" | "subscribing" | "subscribed" | "sync-failed";

/** Read a raw binary subscription key and return it as base64. */
export function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return "";
  let binary = "";
  const bytes = new Uint8Array(key);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Convert a browser `PushSubscription` into the payload we persist. */
export function toSubscriptionInput(sub: PushSubscription): PushSubscriptionInput {
  return {
    endpoint: sub.endpoint,
    expirationTime: sub.expirationTime,
    keys: {
      p256dh: keyToBase64(sub.getKey("p256dh")),
      auth: keyToBase64(sub.getKey("auth")),
    },
  };
}

/** Decode a URL-safe base64 VAPID public key into a raw ArrayBuffer. */
export function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Url);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

/** Whether the current browser can do Web Push (capability check only). */
export function browserSupportsPush(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Current notification permission, or "unsupported" when unavailable. */
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Register the root-scoped service worker. Returns true on success. */
export async function registerServiceWorker(): Promise<boolean> {
  if (!browserSupportsPush()) return false;
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * The service worker registration used for push management, or null.
 * Resolves immediately (doesn't wait for an active worker), so reading the
 * current subscription never blocks startup.
 */
export async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!browserSupportsPush()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Request notification permission. Must be called from a user gesture.
 * Returns the resulting permission; "granted" means we may subscribe.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Current browser push subscription, if any. */
export async function getBrowserSubscription(): Promise<PushSubscription | null> {
  const registration = await getPushRegistration();
  if (!registration?.pushManager) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Create (or reuse) a browser push subscription using the given VAPID public
 * key. Reuses an existing subscription rather than stacking duplicates. Call
 * only after permission is granted.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!browserSupportsPush()) return null;
  // The caller registers the service worker first; wait for it to become
  // active, which `pushManager.subscribe` requires.
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
  if (!registration?.pushManager) return null;

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  } catch {
    return null;
  }
}

/** Unsubscribe from push on this device. Returns true on success/no-op. */
export async function unsubscribeFromPush(): Promise<boolean> {
  const registration = await getPushRegistration();
  if (!registration?.pushManager) return false;
  try {
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return true;
    await sub.unsubscribe();
    return true;
  } catch {
    return false;
  }
}

/** Derived UI state for the notifications section. */
export function describePushState(
  permission: NotificationPermission | "unsupported",
  subscribed: boolean,
): PushStatus {
  if (permission === "unsupported") return "unsupported";
  if (permission === "denied") return "permission-denied";
  if (permission === "granted" && subscribed) return "subscribed";
  return "idle";
}
