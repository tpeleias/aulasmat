import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CronysWordmark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import { isEnglish } from "@/lib/i18n";
import { DeleteAccountEn } from "@/pages/LegalEn";

// Página pública que a Google Play pede ("link da web para solicitar a
// exclusão da conta"). Cadastrar https://<site>/excluir-conta no Play Console,
// em Conteúdo do app → Segurança dos dados.
export default function DeleteAccountInfo() {
  const [contact, setContact] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("settings").select("contact_email").maybeSingle()
      .then(({ data }) => setContact(((data as { contact_email?: string } | null)?.contact_email ?? "").trim() || null));
  }, []);
  useEffect(() => { document.title = isEnglish() ? "Delete account — Cronys" : "Excluir conta — Cronys"; }, []);
  if (isEnglish()) return <DeleteAccountEn contact={contact} />;

  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
          <CronysWordmark tamanho="1.125rem" className="text-foreground" />
        </Link>
        <h1 className="text-2xl font-bold">Como excluir sua conta do Cronys</h1>
        <div className="mt-6 space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="font-semibold text-base">Pelo app ou pelo site</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Entre com o seu login.</li>
              <li>Abra o menu e toque em <strong>Minha conta</strong>.</li>
              <li>Toque em <strong>Excluir minha conta</strong> e confirme digitando EXCLUIR.</li>
            </ol>
            <p>O acesso é apagado na hora.</p>
          </section>
          <section className="space-y-2">
            <h2 className="font-semibold text-base">O que é apagado e o que fica</h2>
            <p>
              É apagado o seu login (e-mail ou usuário e senha) e o vínculo dele com o seu
              cadastro. O histórico de atendimentos e pagamentos pertence à empresa que te atende e
              continua com ela, pelo tempo necessário ao controle financeiro. Para pedir a exclusão
              desses dados também, fale com a empresa.
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="font-semibold text-base">Sem acesso ao app?</h2>
            <p>
              {contact
                ? <>Escreva para {contact} com o e-mail ou usuário da conta, pedindo a exclusão.</>
                : "Peça a exclusão à empresa que te atende, informando o e-mail ou usuário da conta."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
