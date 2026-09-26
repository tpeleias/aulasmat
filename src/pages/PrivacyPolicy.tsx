import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CronysWordmark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import { isEnglish } from "@/lib/i18n";
import { PrivacyEn } from "@/pages/LegalEn";

// The Play Console requires a public privacy policy URL, and it has to describe what the
// app really does. This is a draft written from the app's actual behaviour: read it and
// change anything that does not match how you work.
const UPDATED_AT = "26 de setembro de 2026";

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

  useEffect(() => { document.title = isEnglish() ? "Privacy — Cronys" : "Privacidade — Cronys"; }, []);
  if (isEnglish()) return <PrivacyEn contact={contact} />;

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
              O Cronys organiza os atendimentos com hora marcada de uma empresa ou profissional
              (aulas, consultas, sessões, serviços): agenda, cadastro de clientes, cobrança e
              materiais. Ele é usado pela empresa, pela equipe dela e pelos clientes atendidos.
              Não há publicidade e nenhum dado é vendido.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Dados que o app guarda</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Nome de quem é atendido, nome do responsável e endereço onde o atendimento acontece.</li>
              <li>E-mail ou nome de usuário e senha usados para entrar.</li>
              <li>Data, horário, duração, assunto e situação de cada atendimento, e o resumo que o profissional registrar.</li>
              <li>Valores cobrados, pagamentos registrados e créditos.</li>
              <li>Materiais e tarefas enviados pelo profissional, e arquivos enviados pelo cliente.</li>
            </ul>
            <p>
              O app não acessa contatos, câmera, localização nem microfone, e não coleta dados de
              uso para publicidade.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Para que servem</h2>
            <p>
              Exclusivamente para combinar e registrar os atendimentos, controlar pagamentos e
              disponibilizar materiais. Cada cliente enxerga apenas os próprios dados. O acesso
              próprio de um menor de idade mostra atendimentos, materiais e tarefas, e nunca valores.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Com quem os dados são compartilhados</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Supabase</strong>, onde o banco de dados e os arquivos ficam hospedados.</li>
              <li><strong>Anthropic</strong>, quando a empresa usa o assistente do app: o texto da
                conversa e os dados necessários para responder são enviados para processamento.
                Só o administrador da empresa tem acesso ao assistente.</li>
              <li>O <strong>provedor de pagamento escolhido pela empresa</strong>, se o cliente
                pagar pelo link de pagamento dela. O pagamento acontece no site do provedor, sob a
                política de privacidade dele.</li>
            </ul>
            <p>Fora isso, nada é compartilhado.</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Google Agenda (opcional)</h2>
            <p>
              O profissional pode conectar a própria conta Google. O Cronys passa a ler apenas os{" "}
              <strong>horários ocupados</strong> da agenda principal dele (sem título, descrição ou
              convidados), para bloquear esses horários no Cronys, e cria uma agenda separada chamada
              "Cronys" na conta Google dele, onde inclui, altera e remove os atendimentos desse
              profissional. O Cronys não lê nem altera nenhuma outra agenda ou evento.
            </p>
            <p>
              O uso e a transferência de informações recebidas das APIs do Google seguem a{" "}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" className="text-primary underline">
                Política de Dados do Usuário dos Serviços de API do Google</a>, incluindo os requisitos
              de Uso Limitado. Esses dados não são usados para publicidade, não são vendidos e não são
              usados para treinar modelos de IA. Desconectar pelo app apaga a agenda "Cronys", remove os
              horários importados e revoga o acesso; o acesso também pode ser retirado a qualquer
              momento em myaccount.google.com/permissions.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Dados de crianças e adolescentes</h2>
            <p>
              O cadastro de um menor é feito pela empresa a partir do que o responsável informa, e o
              acesso próprio dele é criado com autorização do responsável. O responsável pode, a
              qualquer momento, pedir a remoção do acesso e dos dados do filho.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Por quanto tempo ficam guardados</h2>
            <p>
              Enquanto durar a relação com a empresa, e depois pelo tempo necessário para o controle
              financeiro. Você pode excluir o seu acesso a qualquer momento pelo app, em Minha
              conta → Excluir minha conta (veja <Link to="/excluir-conta" className="text-primary underline">como excluir</Link>),
              e pedir a exclusão dos demais dados à empresa que te atende.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Seus direitos</h2>
            <p>
              Conforme a Lei Geral de Proteção de Dados, você pode pedir acesso, correção ou
              exclusão dos seus dados e dos dados do seu filho, além de saber com quem foram
              compartilhados.{contact ? <> É só escrever para {contact}.</> : " Basta pedir à empresa que te atende."}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">Contato</h2>
            <p>
              {contact
                ? <>Dúvidas sobre esta política: {contact}.</>
                : "Para dúvidas sobre esta política, fale com a empresa que te atende."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
