import { useId } from "react";
import { Info } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NumberField } from "@/components/NumberField";
import { SCARCITY_DEFAULT, scarcityOff, type ScarcityDay, type ScarcitySetting } from "@/lib/availability";
import { L } from "@/lib/i18n";

/**
 * "Quantos horários o cliente vê" - a escassez, explicada (Thiago, 02/10).
 *
 * Antes era uma grade de mínimo e máximo sem dizer o que fazia, escondida em
 * "Mais opções", e não dava para desligar. Agora é uma escolha clara (todos os
 * horários livres ou só alguns por dia), com o "como funciona" ao lado e a
 * grade só quando ela vale.
 *
 * O mesmo componente serve a empresa (Configurações) e cada profissional. No
 * profissional há a terceira opção, "igual à empresa", que grava nulo.
 */

const DIAS = () => L(["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"], ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const ORDEM = [1, 2, 3, 4, 5, 6, 0]; // segunda primeiro

type Mode = "inherit" | "all" | "some";

function daysOf(x: unknown): Record<string, ScarcityDay> {
  const src = (x && typeof x === "object" ? x : {}) as ScarcitySetting;
  return Object.fromEntries(Object.keys(SCARCITY_DEFAULT).map(k => {
    const d = src[k];
    return [k, d && typeof d === "object" ? d : SCARCITY_DEFAULT[k]];
  }));
}

/** Resumo em uma linha, para o profissional ver o que herda da empresa. */
const scarcitySummary = (x: unknown) =>
  scarcityOff(x) ? L("todos os horários livres", "all free times") : L("só alguns por dia", "only a few per day");

export function ScarcityEditor({ value, onChange, inheritFrom, who }: {
  /** O que está gravado (jsonb). No profissional, nulo = igual à empresa. */
  value: unknown;
  onChange: (next: ScarcitySetting | null) => void;
  /** Só no profissional: a escolha da empresa, para mostrar e copiar. */
  inheritFrom?: unknown;
  /** Nome do profissional, para os textos. */
  who?: string;
}) {
  const id = useId();
  const perTeacher = inheritFrom !== undefined;
  const mode: Mode = perTeacher && !value ? "inherit" : scarcityOff(value) ? "all" : "some";
  // Para onde os números vêm ao passar a "só alguns": os já gravados, ou os da
  // empresa (no profissional), ou o padrão.
  const days = daysOf(value && !scarcityOff(value) ? value : perTeacher && !scarcityOff(inheritFrom) ? inheritFrom : null);

  const pick = (m: Mode) => {
    if (m === "inherit") onChange(null);
    else if (m === "all") onChange({ ...days, off: true });
    else onChange({ ...days });
  };

  const setDay = (k: string, campo: "min" | "max", n: number) => {
    const d = { ...days[k], [campo]: Math.max(0, Math.min(12, Number.isFinite(n) ? Math.round(n) : 0)) };
    // Mínimo maior que o máximo não faz sentido: o outro acompanha.
    if (campo === "min" && d.max < d.min) d.max = d.min;
    if (campo === "max" && d.min > d.max) d.min = d.max;
    onChange({ ...days, [k]: d });
  };

  const options: { m: Mode; title: string; text: string }[] = [
    ...(perTeacher ? [{
      m: "inherit" as Mode,
      title: L("Igual à empresa", "Same as the business"),
      text: L(`Hoje a empresa mostra ${scarcitySummary(inheritFrom)}.`, `The business currently shows ${scarcitySummary(inheritFrom)}.`),
    }] : []),
    {
      m: "all",
      title: L("Todos os horários livres", "All free times"),
      text: L("O cliente vê cada horário livre dentro do horário de trabalho.", "Clients see every free time within working hours."),
    },
    {
      m: "some",
      title: L("Só alguns por dia", "Only a few per day"),
      text: L("A agenda parece mais concorrida e ninguém vê os seus horários vagos.", "Your calendar looks busier and nobody sees all your gaps."),
    },
  ];

  return (
    <div className="space-y-4">
      <RadioGroup value={mode} onValueChange={v => pick(v as Mode)} className="gap-2">
        {options.map(o => (
          <Label key={o.m} htmlFor={`${id}-${o.m}`}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal ${mode === o.m ? "border-primary bg-primary/5" : "border-border"}`}>
            <RadioGroupItem id={`${id}-${o.m}`} value={o.m} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">{o.title}</span>
              <span className="block text-xs text-muted-foreground">{o.text}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>

      {mode === "some" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {L(`Por dia, quantos horários ${who ? `de ${who} ` : ""}aparecem: o app escolhe um número entre o mínimo e o máximo.`,
               `Per day, how many ${who ? `of ${who}'s ` : ""}times show: the app picks a number between the min and max.`)}
            {" "}{L("Máximo 0: o dia aparece sem horários.", "Max 0: the day shows no times.")}
          </p>
          <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2">
            <span />
            <span className="text-center text-[11px] text-muted-foreground">{L("Mínimo", "Min")}</span>
            <span className="text-center text-[11px] text-muted-foreground">{L("Máximo", "Max")}</span>
          </div>
          {ORDEM.map(i => {
            const k = String(i);
            const nome = DIAS()[i];
            return (
              <div key={k} className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2">
                <span className="text-sm">{nome}</span>
                <NumberField min={0} max={12} value={days[k].min} onValueChange={n => setDay(k, "min", n)} aria-label={L(`${nome}: mínimo`, `${nome}: min`)} />
                <NumberField min={0} max={12} value={days[k].max} onValueChange={n => setDay(k, "max", n)} aria-label={L(`${nome}: máximo`, `${nome}: max`)} />
              </div>
            );
          })}
        </div>
      )}

      <Collapsible className="rounded-lg bg-muted/50">
        <CollapsibleTrigger className="flex w-full items-center gap-2 p-3 text-left text-sm font-medium">
          <Info className="h-4 w-4 shrink-0 text-primary" /> {L("Como funciona", "How it works")}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 px-3 pb-3 text-xs text-muted-foreground">
          <p>{L("Vale para a página de horários (o link que você manda ao cliente) e para o portal, quando o cliente pede um horário. A sua agenda mostra sempre tudo.",
                "Applies to the schedule page (the link you send clients) and to the portal, when a client requests a time. Your own calendar always shows everything.")}</p>
          <p>{L("Em \"Só alguns por dia\", o app escolhe quantos e quais horários mostrar. A escolha fica fixa no dia: quem abrir de novo vê os mesmos. Quando um deles é marcado, ele some e nenhum outro entra no lugar.",
                "With \"Only a few per day\", the app picks how many and which times to show. The choice stays fixed for the day: anyone opening it again sees the same ones. When one is booked, it disappears and none replaces it.")}</p>
          <p>{L("Exemplo: segunda com 8 horários livres, mínimo 1 e máximo 3. O cliente vê de 1 a 3 desses 8.",
                "Example: Monday with 8 free times, min 1 and max 3. The client sees 1 to 3 of those 8.")}</p>
          {perTeacher && <p>{L("A escolha do profissional ganha da empresa. Em \"Igual à empresa\", muda junto quando a empresa mudar.",
                               "The professional's choice wins over the business. With \"Same as the business\", it follows any change there.")}</p>}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
