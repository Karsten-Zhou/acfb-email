// A generic anchored overflow/popover menu. Positioned below (or above when it
// would overflow) its trigger, right-aligned and clamped to the viewport.
// Closes on outside click, Escape, window resize, and page scroll. Reusable for
// any "…" / overflow trigger that opens a small action menu.
import { nextTick, onMounted, onUnmounted, ref } from "vue";

export function useOverflowMenu() {
  const open = ref(false);
  const triggerEl = ref<HTMLElement | null>(null);
  const menuEl = ref<HTMLElement | null>(null);
  const pos = ref<{ left: number; top: number } | null>(null);

  /** Pin the menu below the trigger, right-aligned so it stays on-screen. */
  function place() {
    const btn = triggerEl.value;
    const menu = menuEl.value;
    if (!btn || !menu) return;
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const dropUp = window.innerHeight - r.bottom < mh && r.top > mh;
    const top = dropUp ? r.top - mh - 4 : r.bottom + 4;
    const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    pos.value = { left, top };
  }

  async function toggle() {
    if (open.value) {
      close();
      return;
    }
    open.value = true;
    await nextTick();
    place();
  }

  function close() {
    open.value = false;
    pos.value = null;
  }

  function onDocMouseDown(e: MouseEvent) {
    if (!open.value) return;
    const target = e.target as Node;
    if (triggerEl.value?.contains(target) || menuEl.value?.contains(target)) return;
    close();
  }

  function onDocKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  onMounted(() => {
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onDocKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { capture: true, passive: true });
  });
  onUnmounted(() => {
    document.removeEventListener("mousedown", onDocMouseDown);
    window.removeEventListener("keydown", onDocKey);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", close, { capture: true });
  });

  return { open, triggerEl, menuEl, pos, toggle, close, place };
}
