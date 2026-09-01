// Browser push-notification lifecycle for the Settings UI. Notifications are
// purely per-device: enabling subscribes THIS device, disabling unsubscribes
// it; the server keeps other devices independent. Permission is only ever
// requested from an explicit user action (the Settings toggle), never on page
// load.
//
// State is a module-level reactive singleton (mirroring theme/locale), so the
// Settings panel and any other consumer share one source of truth. Pure
// browser helpers live in `src/lib/pushNotifications.ts`.
import { computed, reactive } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import {
  browserSupportsPush,
  describePushState,
  getBrowserSubscription,
  getNotificationPermission,
  registerServiceWorker,
  requestNotificationPermission,
  subscribeToPush,
  toSubscriptionInput,
  unsubscribeFromPush,
  type PushStatus,
} from "../lib/pushNotifications";
import { toastError, toastSuccess } from "../stores/toast";

interface PushState {
  supported: boolean;
  permission: "default" | "granted" | "denied" | "unsupported";
  subscribed: boolean;
  /** Server-side id of this device's persisted subscription, if known. */
  subscriptionId: string | null;
  /** Whether Web Push is configured server-side (VAPID keys present). */
  configured: boolean;
  /** The VAPID public key needed to subscribe. */
  publicKey: string | null;
  loading: "idle" | "subscribe" | "unsubscribe";
}

const state = reactive<PushState>({
  supported: false,
  permission: "default",
  subscribed: false,
  subscriptionId: null,
  configured: false,
  publicKey: null,
  loading: "idle",
});

const status = computed<PushStatus>(() => describePushState(state.permission, state.subscribed));
const busy = computed(() => state.loading !== "idle");

/** Refresh browser-level push state (permission + current subscription). */
async function refreshBrowserState(): Promise<void> {
  state.supported = browserSupportsPush();
  if (!state.supported) {
    state.permission = "unsupported";
    state.subscribed = false;
    return;
  }
  state.permission = getNotificationPermission();
  const sub = await getBrowserSubscription();
  state.subscribed = sub !== null;
}

/** Load the backend capability surface (VAPID key + server config). */
async function loadCapability(): Promise<void> {
  try {
    const cap = await api.pushCapability();
    state.configured = cap.configured;
    state.publicKey = cap.publicKey;
    // If this device already has a persisted subscription, surface its id.
    const sub = await getBrowserSubscription();
    if (sub) {
      state.subscriptionId = cap.subscriptions.find((s) => s.endpoint === sub.endpoint)?.id ?? null;
    }
  } catch {
    state.configured = false;
    state.publicKey = null;
  }
}

/**
 * Initialise on app start / settings open. Reconciles the browser's current
 * subscription with the backend so a stale or changed subscription is updated.
 * Never requests permission here. Silent on failure (non-fatal; retried next
 * time) — it does not flash a toast on every page load.
 */
export async function initPushNotifications(): Promise<void> {
  // Load the server capability first — it drives the "configured" UI state and
  // doesn't depend on the service worker.
  await loadCapability();
  await refreshBrowserState();

  // Ensure the service worker is registered so pushes can be received even if
  // the user already subscribed on a previous visit (register is idempotent).
  if (state.supported) await registerServiceWorker();

  // Recovery: if we're subscribed in the browser but the server doesn't know
  // the current subscription (e.g. it changed since last visit), re-persist it.
  if (state.supported && state.permission === "granted" && state.subscribed) {
    const sub = await getBrowserSubscription();
    if (sub && state.configured && state.publicKey) {
      try {
        const { id } = await api.pushSubscribe(toSubscriptionInput(sub));
        state.subscriptionId = id;
      } catch {
        // Non-fatal: reconciled next time.
      }
    }
  }
}

/**
 * Subscribe on the current device: request permission (user gesture), register
 * the service worker, obtain the VAPID key, create the browser subscription,
 * and persist it server-side. Returns true on success.
 */
export async function enablePushNotifications(): Promise<boolean> {
  if (!state.supported || busy.value) return false;
  state.loading = "subscribe";
  try {
    const perm = await requestNotificationPermission();
    state.permission = perm;
    if (perm !== "granted") {
      if (perm === "denied") {
        toastError(
          t("notifications.permissionDeniedTitle"),
          t("notifications.permissionDeniedBody"),
        );
      }
      return false;
    }

    if (!(await registerServiceWorker())) {
      toastError(t("notifications.enableFailed"));
      return false;
    }

    if (!state.configured || !state.publicKey) await loadCapability();
    if (!state.publicKey) {
      toastError(t("notifications.notConfigured"));
      return false;
    }

    const sub = await subscribeToPush(state.publicKey);
    if (!sub) {
      toastError(t("notifications.enableFailed"));
      return false;
    }

    const { id } = await api.pushSubscribe(toSubscriptionInput(sub));
    state.subscriptionId = id;
    state.subscribed = true;
    toastSuccess(t("notifications.enabledTitle"), t("notifications.enabledBody"));
    return true;
  } catch {
    toastError(t("notifications.enableFailed"));
    return false;
  } finally {
    state.loading = "idle";
  }
}

/**
 * Disable on the current device: unsubscribe from the browser and remove the
 * server-side subscription. Other devices are unaffected.
 */
export async function disablePushNotifications(): Promise<void> {
  if (busy.value) return;
  state.loading = "unsubscribe";
  try {
    const sub = await getBrowserSubscription();
    if (state.subscriptionId !== null) {
      try {
        await api.pushUnsubscribe(state.subscriptionId);
      } catch (err) {
        // 404 means it's already gone; anything else is a real failure.
        const errStatus = (err as { status?: number } | null)?.status;
        if (errStatus !== 404) toastError(t("notifications.disableFailed"));
      }
      state.subscriptionId = null;
    } else if (sub) {
      try {
        await api.pushRemoveByEndpoint(sub.endpoint);
      } catch {
        toastError(t("notifications.disableFailed"));
      }
    }
    await unsubscribeFromPush();
    state.subscribed = false;
  } finally {
    state.loading = "idle";
  }
}

export function usePushNotifications() {
  return {
    state,
    status,
    busy,
    refresh: refreshBrowserState,
    init: initPushNotifications,
    enable: enablePushNotifications,
    disable: disablePushNotifications,
  };
}
