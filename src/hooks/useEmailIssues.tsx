import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { L } from "@/lib/i18n";

/**
 * Os e-mails da empresa que voltaram ou foram marcados como spam (o Resend
 * avisa pelo webhook; account_email_issues, migration 20261003060000). Para o
 * cadastro mostrar "este e-mail voltou" ao lado do campo.
 */
export function useEmailIssues() {
  const [issues, setIssues] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void Promise.resolve()
      .then(() => (supabase.rpc as unknown as (f: string) => Promise<{ data: { email: string; kind: string }[] | null }>)("account_email_issues"))
      .then(({ data }) => setIssues(new Map((data ?? []).map(r => [r.email.toLowerCase(), r.kind]))), () => {});
  }, []);
  return issues;
}

export function EmailIssueNote({ email, issues }: { email: string | null | undefined; issues: Map<string, string> }) {
  const kind = email ? issues.get(email.trim().toLowerCase()) : undefined;
  if (!kind) return null;
  return (
    <p className="mt-1 text-xs text-destructive">
      {kind === "complained"
        ? L("Este e-mail marcou os avisos como spam: não mandamos mais para ele.", "This address marked the emails as spam: we no longer send to it.")
        : L("Os e-mails para este endereço voltaram: confira se está escrito certo.", "Emails to this address bounced: check that it's spelled right.")}
    </p>
  );
}
