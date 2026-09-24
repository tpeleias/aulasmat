import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CronysWordmark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";

// Rascunho escrito a partir do que o app faz de verdade - NÃO é texto revisado
// por advogado. Antes de vender assinatura, alguém da área jurídica precisa
// ler, completar a identificação do fornecedor (nome/razão social, CPF/CNPJ,
// endereço) e ajustar cancelamento/reembolso à política comercial real.
const UPDATED_AT = "24 de setembro de 2026";

export default function TermsOfUse() {
  // Mesmo contato da política de privacidade: o da empresa dona do endereço.
  const [contact, setContact] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("settings").select("contact_email").maybeSingle()
      .then(({ data }) => setContact(((data as { contact_email?: string } | null)?.contact_email ?? "").trim() || null));
  }, []);

  useEffect(() => { document.title = "Termos de uso — Cronys"; }, []);

  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
          <CronysWordmark tamanho="1.125rem" className="text-foreground" />
        </Link>

        <h1 className="text-2xl font-bold">Termos de uso</h1>
        <p className="mt-1 text-sm text-muted-foreground">Atualizados em {UPDATED_AT}.</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="font-semibold text-base">1. O que é o Cronys</h2>
            <p>
              O Cronys é uma ferramenta para profissionais e empresas que atendem com hora marcada
              (escolas e professores, clínicas, consultórios, salões, oficinas e outros) organizarem
              agenda, cadastro de clientes, cobrança, materiais e tarefas. Quem contrata o Cronys é o
              profissional ou a empresa ("empresa"). Clientes e responsáveis usam o app a convite da empresa.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">2. Conta e acesso</h2>
            <p>
              Cada pessoa é responsável pelo sigilo da própria senha e pelo que é feito com o seu
              acesso. A empresa é responsável pelos acessos que cria para clientes, responsáveis e
              profissionais da sua equipe, e por removê-los quando deixarem de ser necessários.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">3. Planos, teste e cancelamento</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>O plano <strong>Cronys Essencial</strong> é gratuito e tem limites de clientes e profissionais.</li>
              <li>O plano <strong>Cronys Pro</strong> é pago e libera os recursos descritos no app.</li>
              <li>A empresa nova começa com um período de teste do Pro. Ao fim dele, se não houver
                contratação, a conta passa para o Essencial: nada é apagado, e o que passar do
                limite do Essencial fica pausado até ser liberado pela empresa.</li>
              <li>A assinatura pode ser cancelada a qualquer momento, valendo até o fim do período já
                pago, respeitado o direito de arrependimento previsto no Código de Defesa do
                Consumidor.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">4. Pagamentos entre a empresa e os clientes</h2>
            <p>
              O Cronys ajuda a empresa a registrar atendimentos e cobrar, mas <strong>não recebe, não
              intermedeia e não garante</strong> pagamentos entre a empresa e os clientes. A chave Pix,
              o link de pagamento e os valores são definidos pela empresa, que responde por eles.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">5. Dados pessoais</h2>
            <p>
              Os dados de clientes e responsáveis pertencem à empresa, que decide como usá-los
              (controladora, nos termos da LGPD). O Cronys guarda e processa esses dados em nome da
              empresa, só para fazer o app funcionar (operador). Os detalhes estão na{" "}
              <Link to="/privacidade" className="text-primary underline">política de privacidade</Link>.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">6. Uso permitido</h2>
            <p>
              Não é permitido usar o Cronys para fins ilegais, cadastrar dados de terceiros sem
              autorização, tentar acessar dados de outra empresa, sobrecarregar o serviço ou
              contornar os limites do plano.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">7. Disponibilidade</h2>
            <p>
              O Cronys é oferecido como está. Buscamos mantê-lo sempre no ar e com os dados
              protegidos, mas podem ocorrer interrupções para manutenção ou por falhas de terceiros
              (hospedagem, lojas de aplicativo, internet). Recomendamos que a empresa exporte seus
              relatórios periodicamente.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">8. Exclusão de conta</h2>
            <p>
              Qualquer pessoa pode excluir o próprio acesso pelo app, em <strong>Minha conta →
              Excluir minha conta</strong>, ou seguindo as instruções em{" "}
              <Link to="/excluir-conta" className="text-primary underline">/excluir-conta</Link>. O
              histórico de atendimentos e pagamentos continua com a empresa, que pode precisar dele para
              controle financeiro; pedidos de exclusão desses dados vão para a empresa.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">9. Mudanças nestes termos</h2>
            <p>
              Estes termos podem mudar. Mudanças relevantes serão avisadas no app antes de valer.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base">10. Contato</h2>
            <p>
              {contact ? <>Dúvidas sobre estes termos: {contact}.</> : "Para dúvidas sobre estes termos, fale com a empresa que te atende."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
