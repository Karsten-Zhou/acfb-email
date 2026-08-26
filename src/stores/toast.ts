// Toast store: minimal reactive toast notifications.
// Surfaces non-blocking feedback for async actions that would otherwise fail
// silently (message load, flags, sync, send, account ops...). reka's Toast
// drives the auto-dismiss timer and exit animation; this store just holds the
// list and a controlled `open` flag per item.
import { reactive } from "vue";

export type ToastKind = "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  description?: string;
  /** Controlled open state, managed by ToastHost so reka can animate the exit. */
  open: boolean;
}

let nextId = 0;

export const toastState = reactive<{
  items: ToastItem[];
}>({
  items: [],
});

export function dismissToast(id: number): void {
  toastState.items = toastState.items.filter((item) => item.id !== id);
}

export function pushToast(kind: ToastKind, message: string, description?: string): number {
  const id = ++nextId;
  toastState.items.push({ id, kind, message, description, open: true });
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
