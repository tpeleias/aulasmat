import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type AuthorizationDetails = {
  client?: { name?: string };
  redirect_url?: string;
  redirect_to?: string;
};

type OAuthAuthorizationApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const oauth = (supabase.auth as typeof supabase.auth & { oauth: OAuthAuthorizationApi }).oauth;

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!authorizationId) { setError("Solicitação de autorização inválida."); return; }
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = `/?next=${encodeURIComponent(next)}`;
        return;
      }
      const { data, error: loadError } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (loadError) { setError(loadError.message); return; }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) { window.location.href = immediate; return; }
      setDetails(data);
    };
    void load();
    return () => { active = false; };
  }, [authorizationId, oauth]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const { data, error: decisionError } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (decisionError) { setError(decisionError.message); setBusy(false); return; }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setError("A autorização não retornou um destino válido."); setBusy(false); return; }
    window.location.href = target;
  };

  const clientName = details?.client?.name ?? "um agente";
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-[var(--shadow-elegant)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck /></div>
          <h1 className="text-2xl font-bold">Conectar {clientName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Essa conexão poderá usar o Site - Aulas com as mesmas permissões da sua conta.</p>
        </div>
        {error ? <p className="mb-5 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        {!details && !error ? <p className="text-center text-sm text-muted-foreground">Carregando autorização…</p> : null}
        {details ? (
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void decide(false)}>Negar</Button>
            <Button className="flex-1" disabled={busy} onClick={() => void decide(true)}>Autorizar</Button>
          </div>
        ) : null}
      </Card>
    </main>
  );
}