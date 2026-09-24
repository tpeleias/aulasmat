import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useVocabulary } from "@/hooks/useVocabulary";
import { usePlan } from "@/hooks/usePlan";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ProUpsell } from "@/components/ProUpsell";
import { BusinessModelPicker } from "@/components/BusinessModelPicker";
import {
  PRESETS, TERM_KEYS, TERM_LABELS, buildVocabulary,
  type BusinessModel, type Gender, type TermKey, type VocabularySpec,
} from "@/lib/vocabulary";

const specOf = (model: BusinessModel | null, custom: unknown): VocabularySpec => {
  const v = buildVocabulary(model, custom);
  return Object.fromEntries(TERM_KEYS.map(k => [k, { s: v[k].s, p: v[k].p, g: v[k].g }])) as VocabularySpec;
};

/**
 * Tipo de negócio e as palavras da tela.
 *
 * As palavras do ramo, e editá-las, são do Pro. No Essencial a tela fala
 * genérico; o ramo ainda pode ser escolhido e fica guardado para o Pro.
 */
export default function VocabularySettings() {
  const { model, custom, customSaved, active, apply } = useVocabulary();
  const { plan, loading: planLoading } = usePlan();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<VocabularySpec>(() => specOf(model, custom));
  const canEdit = plan.vocabulary === true;

  // O que vem do banco (ou de outra aba) reinicia o rascunho.
  useEffect(() => { setDraft(specOf(model, custom)); }, [model, custom]);

  const changeModel = async (m: BusinessModel) => {
    if (m === model) return;
    if (customSaved && !window.confirm("Trocar o tipo de negócio apaga as palavras que você editou. Continuar?")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("set_business_model", { _model: m });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    apply(data);
    toast.success(active
      ? `Agora o app fala como ${PRESETS[m].nome.toLocaleLowerCase("pt-BR")}`
      : "Tipo guardado. Os nomes dele passam a valer no Cronys Pro.");
  };

  const setTerm = (k: TermKey, campo: "s" | "p" | "g", valor: string) =>
    setDraft(d => ({ ...d, [k]: { ...d[k], [campo]: valor } }));

  const save = async () => {
    for (const k of TERM_KEYS) {
      if (!draft[k].s.trim() || !draft[k].p.trim()) {
        toast.error(`Preencha singular e plural de "${TERM_LABELS[k]}"`);
        return;
      }
    }
    // Só vai o que difere do ramo: se o ramo um dia ganhar uma palavra melhor,
    // quem não mexeu naquele termo recebe a nova.
    const base = PRESETS[model ?? "outro"].terms;
    const diff = Object.fromEntries(TERM_KEYS
      .filter(k => draft[k].s.trim() !== base[k].s || draft[k].p.trim() !== base[k].p || draft[k].g !== base[k].g)
      .map(k => [k, { s: draft[k].s.trim(), p: draft[k].p.trim(), g: draft[k].g }]));
    setBusy(true);
    const { data, error } = await supabase.rpc("set_custom_vocabulary", {
      _vocab: Object.keys(diff).length ? diff : null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    apply(data);
    toast.success("Nomes salvos");
  };

  const reset = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("set_custom_vocabulary", { _vocab: null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    apply(data);
    toast.success("Voltou aos nomes do seu tipo de negócio");
  };

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-semibold text-sm uppercase text-muted-foreground">Tipo de negócio</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Decide as palavras de todas as telas - a sua, a da sua equipe e o portal dos seus clientes.
        </p>
      </div>

      <BusinessModelPicker value={model} onChange={changeModel} disabled={busy} />

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <h3 className="text-sm font-semibold">Nomes usados no app</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Ajuste se o seu negócio chama as coisas de outro jeito - por exemplo, "Dentista" em vez de "Médico".
            O gênero decide a concordância: "Nova consulta", "Novo atendimento".
          </p>
        </div>

        <div className="space-y-2">
          {TERM_KEYS.map(k => (
            <div key={k} className="rounded-xl border border-border p-3">
              <Label className="text-xs text-muted-foreground">{TERM_LABELS[k]}</Label>
              <div className="mt-1.5 grid grid-cols-[1fr_1fr_5.5rem] gap-2">
                <Input aria-label={`${TERM_LABELS[k]}: singular`} value={draft[k].s} maxLength={40} disabled={!canEdit || busy}
                  onChange={e => setTerm(k, "s", e.target.value)} placeholder="Singular" />
                <Input aria-label={`${TERM_LABELS[k]}: plural`} value={draft[k].p} maxLength={40} disabled={!canEdit || busy}
                  onChange={e => setTerm(k, "p", e.target.value)} placeholder="Plural" />
                <select
                  aria-label={`${TERM_LABELS[k]}: gênero`}
                  value={draft[k].g}
                  disabled={!canEdit || busy}
                  onChange={e => setTerm(k, "g", e.target.value as Gender)}
                  className="h-10 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                >
                  <option value="m">o / um</option>
                  <option value="f">a / uma</option>
                </select>
              </div>
            </div>
          ))}
        </div>

        {planLoading ? null : canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Salvar nomes
            </Button>
            {customSaved && <Button variant="outline" onClick={reset} disabled={busy}>Voltar ao padrão</Button>}
          </div>
        ) : (
          <>
            <ProUpsell titulo="Os nomes do seu negócio são do Cronys Pro" compacto>
              no Essencial o app usa nomes genéricos: Profissional, Atendimento e Cliente. O tipo escolhido acima
              fica guardado e passa a valer quando a conta for Pro.
            </ProUpsell>
            {customSaved && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                Os nomes que você editou estão guardados e voltam se você voltar ao Pro.
                <Button variant="outline" size="sm" onClick={reset} disabled={busy}>Apagar</Button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
