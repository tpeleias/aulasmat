import { Check } from "lucide-react";
import { L } from "@/lib/i18n";
import { COLOR_KEYS, PALETTE, type ColorKey } from "@/lib/teacherColors";

/** Bolinhas da paleta do app. `allowNone`: a primeira opção é "sem cor". */
export function ColorPicker({ value, onChange, allowNone, noneLabel = L("Sem cor", "No color") }: {
  value: string | null | undefined;
  onChange: (c: ColorKey | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {allowNone && (
        <button type="button" title={noneLabel} aria-label={noneLabel} onClick={() => onChange(null)}
          className={`flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 ${!value ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}>
          {!value && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
      )}
      {COLOR_KEYS.map(k => (
        <button key={k} type="button" title={PALETTE[k].label} aria-label={PALETTE[k].label} onClick={() => onChange(k)}
          className={`flex h-7 w-7 items-center justify-center rounded-full ${PALETTE[k].dot} ${value === k ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}>
          {value === k && <Check className="h-3.5 w-3.5 text-white" />}
        </button>
      ))}
    </div>
  );
}
