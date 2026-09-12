import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";

// A tap only counts when the finger barely moved and the page was not scrolling just
// before it. Brushing the calendar while scrolling used to open dialogs by accident.
// This adds no delay to a deliberate tap, which a timeout would.
export function useTapGuard({ moveTolerance = 12, quietAfterScrollMs = 350 } = {}) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const lastScroll = useRef(0);

  useEffect(() => {
    const onScroll = () => { lastScroll.current = Date.now(); };
    // Capture phase so scrolling inside any container counts, not just the window.
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

  return useCallback((onTap: () => void) => ({
    onPointerDown: (e: PointerEvent) => { down.current = { x: e.clientX, y: e.clientY }; },
    onClick: (e: MouseEvent) => {
      const start = down.current;
      down.current = null;
      if (Date.now() - lastScroll.current < quietAfterScrollMs) return;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > moveTolerance) return;
      onTap();
    },
  }), [moveTolerance, quietAfterScrollMs]);
}
