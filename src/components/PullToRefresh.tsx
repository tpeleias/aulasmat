import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Loader2 } from "lucide-react";
import { haptics } from "@/lib/haptics";

const THRESHOLD = 72;
const MAX_PULL = 110;

// Pull-down-to-refresh for touch screens. The scrolling element is #root, not the
// document (html and body are height-capped), so the gesture asks the nearest real
// scroller how far down it is instead of trusting window.scrollY, which never moves.
function findScroller(el: HTMLElement | null): HTMLElement | null {
  for (let node = el; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * 10/10 (o Thiago achou o app lento): antes, cada movimento do dedo subia a
 * árvore inteira com getComputedStyle e mudava a ALTURA do topo, o que fazia
 * o navegador refazer o layout da tela toda a cada quadro. Agora o rolador é
 * achado uma vez por toque e o puxão é só um deslocamento (transform), que o
 * celular desenha sem recalcular nada.
 */
export default function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const top = () => (scroller.current ? scroller.current.scrollTop : window.scrollY);

  const onTouchStart = (e: TouchEvent) => {
    if (refreshing) return;
    scroller.current = findScroller(box.current);
    if (top() > 0) { startY.current = null; return; }
    startY.current = e.touches[0].clientY;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0 || top() > 0) { if (pull) setPull(0); return; }
    // Resist the pull so it feels elastic rather than 1:1.
    const next = Math.min(MAX_PULL, Math.round(delta * 0.55));
    if (next !== pull) setPull(next);
  };

  const onTouchEnd = async () => {
    if (startY.current === null) return;
    startY.current = null;
    if (pull >= THRESHOLD && !refreshing) {
      haptics.tap();
      setRefreshing(true);
      setPull(Math.round(THRESHOLD * 0.6));
      try { await onRefresh(); } finally { setRefreshing(false); setPull(0); }
    } else if (pull) {
      setPull(0);
    }
  };

  const armed = pull >= THRESHOLD;
  const dragging = startY.current !== null && !refreshing;

  return (
    <div ref={box} className="relative" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center text-muted-foreground"
        style={{ height: pull, opacity: pull ? 1 : 0 }}
        aria-hidden={pull === 0}
      >
        <Loader2 className={`mt-2 h-5 w-5 ${refreshing ? "animate-spin" : ""} ${armed ? "text-primary" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
      </div>
      <div
        style={{ transform: pull ? `translateY(${pull}px)` : undefined, transition: dragging ? "none" : "transform 150ms ease-out" }}
      >
        {children}
      </div>
    </div>
  );
}
