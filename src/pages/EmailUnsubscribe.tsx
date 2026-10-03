import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MailX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { L } from "@/lib/i18n";

/**
 * "Não quero mais receber" dos e-mails automáticos (03/10). O link traz a
 * empresa, o e-mail e uma assinatura (função "emails"); vale para os e-mails
 * daquela empresa para aquele endereço.
 */
export default function EmailUnsubscribe() {
  const [params] = useSearchParams();
  const [state, setState] = useState<"loading" | "done" | "invalid">("loading");
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    document.title = L("Parar de receber e-mails", "Stop emails");
    supabase.functions.invoke("emails", { body: { action: "unsubscribe", c: params.get("c"), e: params.get("e"), t: params.get("t") } })
      .then(({ data, error }) => {
        const d = data as { ok?: boolean; account?: string | null } | null;
        if (error || !d?.ok) { setState("invalid"); return; }
        setAccount(d.account ?? null); setState("done");
      });
  }, [params]);
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md space-y-3 p-6 text-center">
        <MailX className="mx-auto h-8 w-8 text-primary" />
        {state === "loading" && <p className="text-sm text-muted-foreground">{L("Um instante…", "One moment…")}</p>}
        {state === "done" && <>
          <h1 className="text-lg font-semibold">{L("Pronto, você saiu da lista", "Done, you're off the list")}</h1>
          <p className="text-sm text-muted-foreground">{account
            ? L(`Você não vai mais receber e-mails automáticos de ${account}.`, `You won't get automatic emails from ${account} anymore.`)
            : L("Você não vai mais receber estes e-mails automáticos.", "You won't get these automatic emails anymore.")}</p>
        </>}
        {state === "invalid" && <>
          <h1 className="text-lg font-semibold">{L("Link inválido", "Invalid link")}</h1>
          <p className="text-sm text-muted-foreground">{L("Use o link que veio no próprio e-mail.", "Use the link that came in the email itself.")}</p>
        </>}
        <Link to="/" className="text-xs text-primary underline">cronys.com.br</Link>
      </Card>
    </div>
  );
}
