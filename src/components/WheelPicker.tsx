import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

const ROW = 44;

/**
 * Rodinha de rolar, como a do despertador do celular (Thiago, 27/09): a linha
 * do meio é a escolhida. Rolar para e gruda numa linha; tocar numa linha leva
 * ela para o meio; setas do teclado andam de uma em uma.
 *
 * Ocupa a largura que tiver (quem usa dá o limite) e mostra 3 linhas, ou 5
 * com rows={5}.
 */
export function WheelPicker<T extends string | number>({ options, value, onChange, label, format, rows = 3, className }: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  format: (v: T) => string;
  rows?: 3 | 5;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number | null>(null);
  const uid = useId();
  // -1: o valor ainda não está na lista (ex.: hora em branco). Nenhuma linha
  // fica marcada e nada é escolhido até a pessoa mexer.
  const index = options.indexOf(value);
  const pad = ((rows - 1) / 2) * ROW;
  const optionId = (i: number) => `${uid}-${i}`;

  // Valor mudou por fora (ou ao abrir): leva a linha certa para o meio.
  useEffect(() => {
    const el = ref.current;
    if (el && index >= 0 && Math.round(el.scrollTop / ROW) !== index) el.scrollTop = index * ROW;
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
    <div className={cn("relative w-full select-none", className)}>
      {/* A faixa do meio: é o que está escolhido. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 rounded-xl border border-primary/40 bg-primary/10" style={{ top: pad, height: ROW }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-background to-transparent" style={{ height: pad }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background to-transparent" style={{ height: pad }} />
      <div
        ref={ref}
        role="listbox"
        data-vaul-no-drag
        aria-label={label}
        aria-activedescendant={index >= 0 ? optionId(index) : undefined}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); go(index + 1); }
          if (e.key === "ArrowUp") { e.preventDefault(); go(index - 1); }
        }}
        className="snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: rows * ROW, paddingTop: pad, paddingBottom: pad }}
      >
        {options.map((o, i) => (
          <div
            key={String(o)}
            id={optionId(i)}
            role="option"
            aria-selected={i === index}
            onClick={() => go(i)}
            className={`flex h-[44px] snap-center items-center justify-center truncate px-3 text-base tabular-nums transition-colors ${
              i === index ? "font-semibold text-foreground" : "text-muted-foreground"}`}
          >
            <span className="truncate">{format(o)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
