// Toast store: minimal reactive toast notifications (no external dep).
// Surfaces non-blocking feedback for async actions that would otherwise fail
// silently (message load, flags, sync, send, account ops...). Auto-dismisses.
import { reactive } from "vue";

export type ToastKind = "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  description?: string;
}

const AUTO_DISMISS_MS = 5000;
let nextId = 0;

export const toastState = reactive<{
  items: ToastItem[];
}>({
  items: [],
});

const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  toastState.items = toastState.items.filter((item) => item.id !== id);
}

export function pushToast(
  kind: ToastKind,
  message: string,
  description?: string,
): number {
  const id = ++nextId;
  toastState.items.push({ id, kind, message, description });
  const timer = setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
  timers.set(id, timer);
  return id;
}

export function toastError(message: string, description?: string): number {
  return pushToast("error", message, description);
}

export function toastSuccess(message: string, description?: string): number {
  return pushToast("success", message, description);
}

/** Extract a readable message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}