import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { guardianAlwaysShown, type Vocabulary } from "@/lib/vocabulary";
import { L } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Nome do responsável. Em aulas e pet, o campo de sempre. Nos outros ramos
 * (clínica, salão, academia...), quase ninguém tem responsável: aparece a
 * caixinha "Menor de 18 anos", e só marcada abre o campo (Thiago, 28/09).
 * Desmarcar apaga o nome.
 */
export function GuardianField({ w, value, onChange, inputClassName }: {
  w: Vocabulary;
  value: string;
  onChange: (v: string) => void;
  inputClassName?: string;
}) {
  const id = useId();
  const always = guardianAlwaysShown(w.model);
  const filled = value.trim() !== "";
  const [minor, setMinor] = useState(filled);
  // O nome chegou por fora (cliente escolhido da lista): abre a caixa.
  useEffect(() => { if (filled) setMinor(true); }, [filled]);

  const input = <Input id={id} className={inputClassName} value={value} onChange={e => onChange(e.target.value)} />;
  if (always) return <div><Label htmlFor={id}>{w.guardian.s}</Label>{input}</div>;

  return (
    <div className="space-y-2">
      <label className="flex min-h-10 cursor-pointer select-none items-center gap-2 text-sm">
        <Checkbox checked={minor} onCheckedChange={v => { const on = !!v; setMinor(on); if (!on) onChange(""); }} />
        {L("Menor de 18 anos", "Under 18")}
      </label>
      {minor && <div className={cn("space-y-1")}><Label htmlFor={id}>{w.guardian.s}</Label>{input}</div>}
    </div>
  );
}
