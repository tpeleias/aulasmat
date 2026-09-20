import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CronysWordmark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";

// The Play Console requires a public privacy policy URL, and it has to describe what the
// app really does. This is a draft written from the app's actual behaviour: read it and
// change anything that does not match how you work.
const UPDATED_AT = "13 de setembro de 2026";

export default function PrivacyPolicy() {
  // O e-mail de contato vem do banco, por empresa. Estava cravado aqui, e com
  // isso toda empresa cliente publicava na política dela o e-mail do dono do
  // primeiro negócio. Página pública: quem responde é a empresa dona do
  // endereço (ver public_account_id no banco).
  const [contact, setContact] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("settings").select("contact_email").maybeSingle()
      .then(({ data }) => setContact(((data as any)?.contact_email ?? "").trim() || null));
  }, []);

  useEffect(() => { document.title = "Privacidade — Cronys"; }, []);

  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
          <CronysWordmark tamanho="1.125rem" className="text-foreground" />
        </Link>

        <h1 className="text-2xl font-bold">Política de privacidade</h1>
        <p className="mt-1 text-sm text-muted-foreground">Atualizada em {UPDATED_AT}.</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="font-semibold text-base">O que é este app</h2>
            <p>
              O Cronys organiza as aulas particulares dadas por um professor: agenda, cadastro de
              alunos, cobrança e materiais. Ele é usado pelo professor e pelas famílias atendidas.
              Não há publicidade e nenhum dado é vendido.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Dados que o app guarda</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Nome do aluno, nome do responsável e endereço onde a aula acontece.</li>
              <li>E-mail ou nome de usuário e senha usados para entrar.</li>
              <li>Data, horário, duração, matéria e situação de cada aula.</li>
              <li>Valores cobrados, pagamentos registrados e créditos.</li>
              <li>Materiais e tarefas enviados pelo professor, e arquivos enviados pelo aluno.</li>
            </ul>
            <p>
              O app não acessa contatos, câmera, localização nem microfone, e não coleta dados de
              uso para publicidade.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Para que servem</h2>
            <p>
              Exclusivamente para combinar e registrar as aulas, controlar pagamentos e
              disponibilizar materiais. Cada família enxerga apenas os próprios dados. O acesso do
              aluno menor de idade mostra aulas, materiais e tarefas, e nunca valores.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Com quem os dados são compartilhados</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Supabase</strong>, onde o banco de dados e os arquivos ficam hospedados.</li>
              <li><strong>Anthropic</strong>, quando o professor usa o assistente do app: o texto da
                conversa e os dados necessários para responder são enviados para processamento.
                Só o professor tem acesso ao assistente.</li>
              <li><strong>InfinitePay</strong>, se a família escolher pagar pelo link. O pagamento
                acontece no site deles, sob a política de privacidade deles.</li>
            </ul>
            <p>Fora isso, nada é compartilhado.</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Dados de crianças e adolescentes</h2>
            <p>
              O cadastro do aluno é feito pelo professor a partir do que o responsável informa, e o
              acesso do aluno é criado com autorização do responsável. O responsável pode, a
              qualquer momento, pedir a remoção do acesso e dos dados do filho.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Por quanto tempo ficam guardados</h2>
            <p>
              Enquanto durar a relação de aulas, e depois pelo tempo necessário para o controle
              financeiro. A qualquer momento você pode pedir a exclusão.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Seus direitos</h2>
            <p>
              Conforme a Lei Geral de Proteção de Dados, você pode pedir acesso, correção ou
              exclusão dos seus dados e dos dados do seu filho, além de saber com quem foram
              compartilhados.{contact ? <> É só escrever para {contact}.</> : " Basta pedir ao professor responsável pelas aulas."}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Contato</h2>
            <p>
              {contact
                ? <>Dúvidas sobre esta política: {contact}.</>
                : "Para dúvidas sobre esta política, fale com o professor responsável pelas aulas."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
