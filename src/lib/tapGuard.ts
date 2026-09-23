import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";

// A tap only counts when the finger barely moved and the page was not scrolling just
// before it. Brushing the calendar while scrolling used to open dialogs by accident.
//
// `delayMs` adds a short wait before acting, cancelled if a scroll starts in the
// meantime. It is opt-in: on the Android app a flick that begins on a lesson could
// still register as a tap before the scroll event arrived, so the agenda uses a
// small delay there; on desktop a deliberate click should stay instant.
export function useTapGuard({ moveTolerance = 12, quietAfterScrollMs = 350, delayMs = 0 } = {}) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const lastScroll = useRef(0);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const cancel = () => {
      if (pending.current !== null) { window.clearTimeout(pending.current); pending.current = null; }
    };
    const onScroll = () => { lastScroll.current = Date.now(); cancel(); };
    // Capture phase so scrolling inside any container counts, not just the window.
    window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("scroll", onScroll, true); cancel(); };
  }, []);

  return useCallback((onTap: () => void) => ({
    onPointerDown: (e: PointerEvent) => { down.current = { x: e.clientX, y: e.clientY }; },
    onClick: (e: MouseEvent) => {
      const start = down.current;
      down.current = null;
      if (Date.now() - lastScroll.current < quietAfterScrollMs) return;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > moveTolerance) return;
      if (delayMs <= 0) { onTap(); return; }
      if (pending.current !== null) window.clearTimeout(pending.current);
      pending.current = window.setTimeout(() => { pending.current = null; onTap(); }, delayMs);
    },
  }), [moveTolerance, quietAfterScrollMs, delayMs]);
}
