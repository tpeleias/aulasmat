import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Loader2 } from "lucide-react";
import { haptics } from "@/lib/haptics";

const THRESHOLD = 72;
const MAX_PULL = 110;

// Pull-down-to-refresh for touch screens. The scrolling element is #root, not the
// document (html and body are height-capped), so the gesture asks the nearest real
// scroller how far down it is instead of trusting window.scrollY, which never moves.
function scrollTopOf(el: HTMLElement | null): number {
  for (let node = el; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node.scrollTop;
    }
  }
  return window.scrollY;
}
export default function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = (e: TouchEvent) => {
    if (refreshing || scrollTopOf(box.current) > 0) return;
    startY.current = e.touches[0].clientY;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0 || scrollTopOf(box.current) > 0) { setPull(0); return; }
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
    <div ref={box} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
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
