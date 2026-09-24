import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildVocabulary, isBusinessModel, type BusinessModel, type Vocabulary } from "@/lib/vocabulary";

// O que o banco devolve em my_vocabulary() (migration 20260924060000).
type Raw = { business_model: string | null; active?: boolean; custom: unknown; custom_saved?: boolean };

type Ctx = {
  /** As palavras da empresa: `v.appointment.s` é "Aula", "Consulta", "Revisão"... */
  v: Vocabulary;
  /** O ramo escolhido. Nulo: não escolheu ainda, ou o banco não respondeu. */
  model: BusinessModel | null;
  /**
   * Se o plano deixa usar as palavras do ramo (Pro). Falso: a tela fala
   * genérico - Profissional, Atendimento, Cliente - mesmo com ramo escolhido.
   */
  active: boolean;
  /**
   * O banco respondeu, e a empresa ainda não escolheu o ramo. Só isto abre a
   * tela de boas-vindas - `model` nulo sozinho também acontece com erro de rede.
   */
  needsOnboarding: boolean;
  /** As palavras editadas que valem agora (só no Pro). */
  custom: unknown;
  /** Há palavras editadas guardadas, mesmo que o plano atual não as use. */
  customSaved: boolean;
  loading: boolean;
  /** Aplica a resposta de set_business_model / set_custom_vocabulary sem ir ao banco de novo. */
  apply: (raw: unknown) => void;
  reload: () => Promise<void>;
};

// Guardado no aparelho para a tela já abrir com as palavras certas: sem isso,
// uma clínica veria "Profissional" piscar antes de "Médico" a cada abertura.
// É só conveniência - quem manda é o banco, e a resposta dele sobrescreve.
const CACHE_KEY = "cronys.vocabulary";

function readCache(): Raw | null {
  try {
    const s = localStorage.getItem(CACHE_KEY);
    return s ? (JSON.parse(s) as Raw) : null;
  } catch { return null; }
}

function writeCache(raw: Raw | null) {
  try {
    if (raw) localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* sem armazenamento: só perde o atalho */ }
}

function parse(raw: unknown): Raw | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    business_model: isBusinessModel(r.business_model) ? r.business_model : null,
    // Ausente = resposta de antes desta regra (cache antigo): vale o ramo.
    active: r.active !== false,
    custom: r.custom ?? null,
    custom_saved: r.custom_saved === true,
  };
}

const VocabularyContext = createContext<Ctx | null>(null);

export function VocabularyProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [raw, setRaw] = useState<Raw | null>(readCache);
  const [loading, setLoading] = useState(true);
  // Se o banco respondeu nesta sessão. Com erro - rede, ou o front-end publicado
  // antes da migration, que é o que o Netlify faz a cada merge - o app segue
  // com o que sabia e, sem nada, com as palavras de aula (o ramo de toda
  // empresa que existia antes disto). Nunca abre a tela de boas-vindas por
  // falta de resposta: seria pedir o ramo a quem já tem.
  const [answered, setAnswered] = useState(false);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_vocabulary");
    // Erro de rede não apaga o que já se sabe; resposta vazia (sem empresa) apaga.
    if (!error) {
      const parsed = parse(data);
      setRaw(parsed);
      writeCache(parsed);
    }
    setAnswered(!error);
    setLoading(false);
  }, []);

  // Trocar de usuário é trocar de empresa: pede de novo.
  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    void reload();
  }, [authLoading, user?.id, reload]);

  const apply = useCallback((data: unknown) => {
    const parsed = parse(data);
    if (!parsed) return;
    setRaw(parsed);
    writeCache(parsed);
    setAnswered(true);
  }, []);

  const value = useMemo<Ctx>(() => {
    const model = raw && isBusinessModel(raw.business_model) ? raw.business_model : null;
    const active = raw?.active !== false;
    const shown = !answered && !raw && !loading ? "aulas" : active ? model : null;
    return {
      v: buildVocabulary(shown, active ? raw?.custom : null),
      model,
      active,
      needsOnboarding: answered && raw !== null && model === null,
      custom: raw?.custom ?? null,
      customSaved: raw?.custom_saved === true,
      loading,
      apply,
      reload,
    };
  }, [raw, loading, answered, apply, reload]);

  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>;
}

const FORA_DO_PROVIDER: Ctx = {
  v: buildVocabulary(null),
  model: null,
  active: false,
  needsOnboarding: false,
  custom: null,
  customSaved: false,
  loading: false,
  apply: () => {},
  reload: async () => {},
};

/** As palavras da empresa de quem está logado (ou da dona do endereço, sem login). */
export function useVocabulary(): Ctx {
  return useContext(VocabularyContext) ?? FORA_DO_PROVIDER;
}

/** Atalho para quem só precisa das palavras. */
export function useWords(): Vocabulary {
  return useVocabulary().v;
}
