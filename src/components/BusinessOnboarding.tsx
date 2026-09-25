import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVocabulary } from "@/hooks/useVocabulary";
import { Button } from "@/components/ui/button";
import { CronysWordmark } from "@/components/brand";
import { BusinessModelPicker } from "@/components/BusinessModelPicker";
import { haptics } from "@/lib/haptics";
import type { BusinessModel } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
/**
 * Primeiro acesso do dono de uma empresa nova: escolher o ramo.
 *
 * Aparece enquanto accounts.business_model for nulo - toda empresa criada pelo
 * cadastro ou pelo painel do gestor nasce assim. O ramo decide as palavras da
 * tela inteira (Professor/Médico, Aula/Consulta...). Dá para trocar depois em
 * Configurações, então aqui a escolha é rápida e sem medo.
 */
export default function BusinessOnboarding() {
  const { signOut } = useAuth();
  const { apply, active } = useVocabulary();
  const [choice, setChoice] = useState<BusinessModel | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!choice) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("set_business_model", { _model: choice });
    setBusy(false);
    if (error) { haptics.warning(); toast.error(error.message); return; }
    haptics.success();
    apply(data);
  };

  return (
    <div className="flex flex-1 justify-center overflow-y-auto bg-background px-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="space-y-2">
          <CronysWordmark tamanho="1.5rem" />
          <h1 className="text-2xl font-semibold">{L("Que tipo de negócio é o seu?", "What kind of business do you run?")}</h1>
          <p className="text-sm text-muted-foreground">
            {L("O app usa as palavras do seu ramo em todas as telas - para você, para a sua equipe e para os seus clientes. Dá para trocar depois em Configurações.",
               "The app uses the words of your field on every screen - for you, your team and your clients. You can change it later in Settings.")}
          </p>
          {!active && (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {L("Sua conta está no Cronys Essencial, que usa nomes genéricos (Profissional, Atendimento, Cliente). O tipo escolhido fica guardado e passa a valer no Cronys Pro.",
                 "Your account is on Cronys Essential, which uses generic words (Professional, Appointment, Client). The type you choose is saved and applies on Cronys Pro.")}
            </p>
          )}
        </div>

        <BusinessModelPicker value={choice} onChange={setChoice} disabled={busy} />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" className="rounded-xl" onClick={signOut}>{L("Sair", "Sign out")}</Button>
          <Button className="h-12 gap-2 rounded-xl px-6 text-base" disabled={!choice || busy} onClick={confirm}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {L("Continuar", "Continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
