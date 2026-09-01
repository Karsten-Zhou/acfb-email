/**
 * ACFB Email — service worker.
 *
 * Scope: root (`/sw.js`), so it handles the whole app and can receive Push
 * events. It stays deliberately small: it only renders native notifications
 * from the (encrypted) push payload and handles notification clicks. No
 * application business logic or state lives here.
 *
 * The push payload is produced server-side (`server/push/service.ts`) and
 * delivered via Web Push. Content is always plain text — never HTML.
 */

/** Icon shown on notifications. Falls back to the favicon. */
const ICON = "/favicon.svg";
const BADGE = "/favicon.svg";

/**
 * Parse the structured notification payload sent in the push message.
 * Returns null when the payload is missing/malformed so we never crash or
 * render garbage from untrusted mail content.
 */
function readPayload(event) {
  try {
    const data = event.data ? event.data.json() : null;
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  if (!payload) return;

  // A "revoke" push dismisses an existing notification (the mail was read on
  // another device). It never shows anything itself.
  if (payload.type === "revoke") {
    const tag = typeof payload.tag === "string" ? payload.tag : null;
    if (!tag) return;
    event.waitUntil(
      (async () => {
        const notifications = await self.registration.getNotifications({ tag });
        for (const notification of notifications) notification.close();
      })(),
    );
    return;
  }

  if (typeof payload.title !== "string" || typeof payload.body !== "string") return;

  // `tag` lets the push service coalesce rapid-fire messages and replace an
  // existing visible notification for the same mail instead of stacking.
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: ICON,
      badge: BADGE,
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      data: {
        url: typeof payload.url === "string" ? payload.url : "/mail",
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url ?? "/mail";
  const url = new URL(targetUrl, self.location.origin);

  event.waitUntil(
    (async () => {
      // If a window of the app is already open, focus it (and navigate to the
      // message) instead of opening a duplicate.
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windowClients) {
        try {
          await client.focus();
          await client.navigate(url.toString());
          return;
        } catch {
          // Client isn't controllable (e.g. a cross-origin tab); fall through
          // to opening a fresh window.
        }
      }
      await self.clients.openWindow(url.toString());
    })(),
  );
});
