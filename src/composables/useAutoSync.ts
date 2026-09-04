// Auto-sync: while the app is open, periodically enqueue a fast inbox check
// (server "check" mode). Active-tab vs background-tab cadence; 0 = off (the
// server cron covers when the app isn't open).
import { onMounted, onUnmounted, watch } from "vue";
import { syncPrefs } from "../lib/syncPrefs";
import { runSyncCheck } from "../stores/accounts";

export function useAutoSync() {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const cadenceMinutes = () =>
    document.visibilityState === "visible" ? syncPrefs.activeMinutes : syncPrefs.inactiveMinutes;

  const schedule = (delayMs?: number) => {
    clearTimer();
    const mins = cadenceMinutes();
    if (mins <= 0) return;
    timer = setTimeout(tick, delayMs ?? mins * 60_000);
  };

  const tick = async () => {
    try {
      await runSyncCheck();
    } catch {
      // A failed check is non-fatal; the next cycle retries.
    }
    schedule();
  };

  // Re-evaluate shortly after the tab becomes visible/hidden.
  const onVisibility = () => schedule(5_000);

  // Re-arm when the cadence preference changes.
  watch(
    () => [syncPrefs.activeMinutes, syncPrefs.inactiveMinutes] as const,
    () => schedule(),
  );

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibility);
    // Small initial delay so the first check doesn't race the startup load.
    schedule(20_000);
  });

  onUnmounted(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    clearTimer();
  });
}
