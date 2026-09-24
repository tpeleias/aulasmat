import { Briefcase, Brain, Dumbbell, GraduationCap, PawPrint, Scissors, Stethoscope, Wrench, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BUSINESS_MODELS, PRESETS, buildVocabulary, vocabularySummary, type BusinessModel } from "@/lib/vocabulary";
import { haptics } from "@/lib/haptics";

const BUSINESS_ICONS: Record<BusinessModel, LucideIcon> = {
  aulas: GraduationCap,
  saude: Stethoscope,
  psicologia: Brain,
  beleza: Scissors,
  pet: PawPrint,
  esportes: Dumbbell,
  oficina: Wrench,
  outro: Briefcase,
};

/**
 * Os ramos em cartões, cada um com as palavras que ele traz. Usado na tela de
 * boas-vindas e nas configurações.
 */
export function BusinessModelPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: BusinessModel | null;
  onChange: (m: BusinessModel) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Tipo de negócio" className="grid gap-2 sm:grid-cols-2">
      {BUSINESS_MODELS.map(m => {
        const Icon = BUSINESS_ICONS[m];
        const selected = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => { haptics.tap(); onChange(m); }}
            className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors disabled:opacity-60 ${
              selected ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/60"
            }`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                {PRESETS[m].nome}
                {selected && <Check className="h-4 w-4 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground">{PRESETS[m].exemplo}</div>
              <div className="mt-1 text-xs font-medium text-foreground/80">{vocabularySummary(buildVocabulary(m))}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
