import { useEffect, useRef } from "react";

const ROW = 44;

/**
 * Rodinha de rolar, como a do despertador do celular (Thiago, 27/09): mostra
 * três linhas, a do meio é a escolhida. Rolar para e gruda numa linha; tocar
 * numa linha leva ela para o meio; setas do teclado andam de uma em uma.
 */
export function WheelPicker<T extends string | number>({ options, value, onChange, label, format }: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  format: (v: T) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number | null>(null);
  const index = Math.max(0, options.indexOf(value));

  // Valor mudou por fora (ou ao abrir): leva a linha certa para o meio.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ROW) !== index) el.scrollTop = index * ROW;
  }, [index]);

  const onScroll = () => {
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
      if (options[i] !== value) onChange(options[i]);
    }, 120);
  };

  const go = (i: number) => {
    const j = Math.min(options.length - 1, Math.max(0, i));
    ref.current?.scrollTo?.({ top: j * ROW, behavior: "smooth" });
    if (options[j] !== value) onChange(options[j]);
  };

  return (
    <div className="relative w-40 select-none">
      {/* A faixa do meio: é o que está escolhido. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[44px] h-[44px] rounded-xl border border-primary/40 bg-primary/10" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[44px] bg-gradient-to-b from-background to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[44px] bg-gradient-to-t from-background to-transparent" />
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`wheel-${String(value)}`}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); go(index + 1); }
          if (e.key === "ArrowUp") { e.preventDefault(); go(index - 1); }
        }}
        className="h-[132px] snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ paddingTop: ROW, paddingBottom: ROW }}
      >
        {options.map((o, i) => (
          <div
            key={String(o)}
            id={`wheel-${String(o)}`}
            role="option"
            aria-selected={i === index}
            onClick={() => go(i)}
            className={`flex h-[44px] snap-center items-center justify-center text-base tabular-nums transition-colors ${
              i === index ? "font-semibold text-foreground" : "text-muted-foreground"}`}
          >
            {format(o)}
          </div>
        ))}
      </div>
    </div>
  );
}
