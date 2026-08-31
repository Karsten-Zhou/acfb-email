// useRemoteImageControl — shared remote-image privacy logic for the reader pane
// and the mobile message view. Computes whether a message's external images are
// hidden (based on the setting + sender), sanitizes the body accordingly, and
// exposes the actions from the "images blocked" banner. The banner itself lives
// in a small partial component (RemoteImagesBanner.vue).
import { computed, ref, watch } from "vue";
import { sanitizeHtml, type SanitizeResult } from "../lib/sanitize";
import {
  remoteImagesState,
  shouldBlockRemoteImages,
  setRemoteImageSetting,
  setRemoteImageAllowlist,
  isSenderAllowed,
} from "../lib/remoteImages";
import type { MessageDetail } from "@shared/types";

export function useRemoteImageControl(message: () => MessageDetail | null | undefined) {
  /** Per-message "load this time" override; does not touch saved settings. */
  const loadImagesOnce = ref(false);
  const senderAddress = computed(() => message()?.from?.address ?? null);
  const imagesBlocked = computed(() => {
    if (loadImagesOnce.value) return false;
    return shouldBlockRemoteImages(senderAddress.value);
  });

  // Reset the override (and any open banner menu) when the message changes.
  const onMessageChange: Array<() => void> = [];
  watch(
    () => message()?.id,
    () => {
      loadImagesOnce.value = false;
      onMessageChange.forEach((fn) => fn());
    },
  );
  function onMessageChangePush(fn: () => void) {
    onMessageChange.push(fn);
  }

  const sanitized = computed<SanitizeResult | null>(() => {
    const m = message();
    if (!m) return null;
    return sanitizeHtml(m.html || m.text || "", {
      messageId: m.id,
      attachments: m.attachments,
      blockRemoteImages: imagesBlocked.value,
    });
  });

  const showBanner = computed(
    () => imagesBlocked.value && (sanitized.value?.blockedRemoteImages ?? 0) > 0,
  );

  function loadImagesThisTime() {
    loadImagesOnce.value = true;
  }

  /** Whitelist this sender, switching to whitelist mode so the choice sticks. */
  function allowFromSender() {
    const addr = senderAddress.value;
    if (!addr) {
      loadImagesOnce.value = true;
      return;
    }
    if (!isSenderAllowed(addr)) {
      setRemoteImageAllowlist([...remoteImagesState.allowlist, addr]);
    }
    setRemoteImageSetting("whitelist");
    loadImagesOnce.value = true;
  }

  function alwaysAllowImages() {
    setRemoteImageSetting("allow");
    loadImagesOnce.value = true;
  }

  return {
    sanitized,
    showBanner,
    loadImagesThisTime,
    allowFromSender,
    alwaysAllowImages,
    onMessageChangePush,
  };
}
