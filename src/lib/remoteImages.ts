// Remote-image privacy store: whether the app may load external images in
// email bodies, and (in whitelist mode) which senders are trusted. Persisted
// in localStorage, mirroring the theme/locale pattern — this is purely a
// client-side rendering decision.
import { reactive } from "vue";

export type RemoteImageSetting = "allow" | "block" | "whitelist";

const STORAGE_KEY = "ec_remote_images";

interface RemoteImagesState {
  setting: RemoteImageSetting;
  /** Sender addresses or bare domains trusted to load remote images. */
  allowlist: string[];
}

const state = reactive<RemoteImagesState>({ setting: "block", allowlist: [] });

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ setting: state.setting, allowlist: state.allowlist }),
  );
}

/** Load persisted state (safe against absent/corrupt storage). */
export function initRemoteImages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<RemoteImagesState>;
    if (
      parsed.setting === "allow" ||
      parsed.setting === "block" ||
      parsed.setting === "whitelist"
    ) {
      state.setting = parsed.setting;
    }
    if (Array.isArray(parsed.allowlist)) {
      state.allowlist = parsed.allowlist.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      );
    }
  } catch {
    /* ignore corrupt storage; keep defaults */
  }
}

export function setRemoteImageSetting(setting: RemoteImageSetting) {
  state.setting = setting;
  persist();
}

export function setRemoteImageAllowlist(allowlist: string[]) {
  state.allowlist = allowlist;
  persist();
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * True when `address` matches the whitelist: either an exact address
 * (`foo@bar.com`) or a bare domain (`bar.com`) matching the sender's domain.
 */
export function isSenderAllowed(address: string | null | undefined): boolean {
  if (!address) return false;
  const a = normalize(address);
  const domain = a.includes("@") ? a.slice(a.indexOf("@") + 1) : a;
  return state.allowlist.some((entry) => {
    const e = normalize(entry);
    if (e === a) return true;
    return !e.includes("@") && domain === e;
  });
}

/** Should remote images be blocked for a given sender under current settings? */
export function shouldBlockRemoteImages(address: string | null | undefined): boolean {
  if (state.setting === "allow") return false;
  if (state.setting === "whitelist") return !isSenderAllowed(address);
  return true; // "block"
}

export { state as remoteImagesState };
