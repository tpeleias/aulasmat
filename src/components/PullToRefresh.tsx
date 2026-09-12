import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Loader2 } from "lucide-react";
import { haptics } from "@/lib/haptics";

const THRESHOLD = 72;
const MAX_PULL = 110;

// Pull-down-to-refresh for touch screens. The page scrolls with the document, so the
// gesture only starts when the window is already at the very top.
export default function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = (e: TouchEvent) => {
    if (refreshing || window.scrollY > 0) return;
    startY.current = e.touches[0].clientY;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0 || window.scrollY > 0) { setPull(0); return; }
    // Resist the pull so it feels elastic rather than 1:1.
    setPull(Math.min(MAX_PULL, delta * 0.55));
  };

  const onTouchEnd = async () => {
    if (startY.current === null) return;
    startY.current = null;
    if (pull >= THRESHOLD && !refreshing) {
      haptics.tap();
      setRefreshing(true);
      setPull(THRESHOLD * 0.6);
      try { await onRefresh(); } finally { setRefreshing(false); setPull(0); }
    } else {
      setPull(0);
    }
  };

  const armed = pull >= THRESHOLD;

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div
        className="flex items-center justify-center overflow-hidden text-muted-foreground transition-[height] duration-150"
        style={{ height: pull }}
        aria-hidden={pull === 0}
      >
        <Loader2 className={`h-5 w-5 ${refreshing ? "animate-spin" : ""} ${armed ? "text-primary" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
      </div>
      {children}
    </div>
  );
}
