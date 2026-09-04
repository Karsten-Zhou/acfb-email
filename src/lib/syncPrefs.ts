// Auto-check cadence while the app is open (active vs background tab). A
// client-side pref in localStorage, like theme/remote-images; the server cron
// covers when the app is closed.
import { reactive } from "vue";

export const SYNC_CADENCE_OPTIONS = [0, 1, 2, 5, 10] as const;
/** Minutes between auto-checks; 0 disables auto-checks. */
export type SyncCadence = (typeof SYNC_CADENCE_OPTIONS)[number];

const STORAGE_KEY = "ec_sync_prefs";

interface SyncPrefsState {
  activeMinutes: SyncCadence;
  inactiveMinutes: SyncCadence;
}

const state = reactive<SyncPrefsState>({ activeMinutes: 2, inactiveMinutes: 0 });

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ activeMinutes: state.activeMinutes, inactiveMinutes: state.inactiveMinutes }),
  );
}

function validCadence(v: unknown): v is SyncCadence {
  return (SYNC_CADENCE_OPTIONS as readonly number[]).includes(v as number);
}

/** Load persisted state (safe against absent/corrupt storage). */
export function initSyncPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<SyncPrefsState>;
    if (validCadence(parsed.activeMinutes)) state.activeMinutes = parsed.activeMinutes;
    if (validCadence(parsed.inactiveMinutes)) state.inactiveMinutes = parsed.inactiveMinutes;
  } catch {
    /* ignore corrupt storage; keep defaults */
  }
}

export function setActiveCadence(minutes: SyncCadence) {
  state.activeMinutes = minutes;
  persist();
}

export function setInactiveCadence(minutes: SyncCadence) {
  state.inactiveMinutes = minutes;
  persist();
}

export { state as syncPrefs };
