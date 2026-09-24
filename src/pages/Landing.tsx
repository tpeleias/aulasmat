import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Check, HandCoins, QrCode, Smartphone, Users, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CronysWordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PRESETS, BUSINESS_MODELS } from "@/lib/vocabulary";
import { PLANS, EXTRA_TEACHER, brl } from "@/lib/subscription";

const RECURSOS = [
  { icon: CalendarDays, titulo: "Agenda que não deixa marcar em cima", texto: "Horário ocupado é recusado na hora, até quando dois pedidos chegam juntos. Bloqueios pontuais e semanais." },
  { icon: CalendarClock, titulo: "O cliente pede, você aprova", texto: "Portal para a família ou o cliente ver os horários livres, pedir horário ou troca, e acompanhar o que foi marcado." },
  { icon: HandCoins, titulo: "Quem deve, quanto e desde quando", texto: "Cada atendimento dado vira cobrança sozinho. Pacotes, vouchers, desconto por família, recibo e relatório para o IR." },
  { icon: QrCode, titulo: "Pix copia e cola com o valor", texto: "A mensagem de cobrança já sai com o código Pix do total. O cliente paga com um toque." },
  { icon: Users, titulo: "Equipe com acesso próprio", texto: "Cada profissional vê a própria agenda. Financeiro e configurações ficam só com quem administra." },
  { icon: Smartphone, titulo: "No celular e no computador", texto: "App para Android e site no navegador, com os mesmos dados." },
];

/**
 * A página do Cronys para quem chega pelo endereço sem estar logado. É também
 * o que o Stripe olha para aprovar a conta: o que é vendido, por quanto,
 * termos, privacidade e contato - tudo precisa estar aqui ou a um clique.
 */
export default function Landing() {
  const [contact, setContact] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Cronys — agenda, clientes e cobrança para quem atende com hora marcada";
    supabase.from("settings").select("contact_email").maybeSingle()
      .then(({ data }) => setContact(((data as { contact_email?: string } | null)?.contact_email ?? "").trim() || null));
  }, []);

  return (
    <div className="flex-1 bg-background">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <CronysWordmark tamanho="1.5rem" className="text-brand-ink" />
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground">
              <Link to="/entrar">Entrar</Link>
            </Button>
          </div>
        </div>
        <div className="relative mx-auto max-w-5xl overflow-hidden px-4 pb-16 pt-10">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-10 h-64 w-64 rounded-full bg-brand-gold/12 blur-3xl" />
          <h1 className="relative max-w-2xl text-3xl font-bold leading-tight tracking-tight md:text-5xl">
            Agenda, clientes e cobrança para quem atende com hora marcada.
          </h1>
          <p className="relative mt-4 max-w-xl text-sidebar-foreground/75 md:text-lg">
            Aulas particulares, clínicas, consultórios, salões, pet shops, estúdios e oficinas.
            O app fala a língua do seu ramo.
          </p>
          <div className="relative mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-xl"><Link to="/entrar?criar=empresa">Começar - 14 dias do Pro grátis</Link></Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl border-white/30 bg-transparent text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground">
              <a href="#planos">Ver planos</a>
            </Button>
          </div>
          <p className="relative mt-3 text-xs text-sidebar-foreground/60">Sem cartão para testar. Depois do teste, continua de graça no Essencial.</p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-14">
          <h2 className="text-2xl font-bold">Para quem</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {BUSINESS_MODELS.filter(m => m !== "outro").map(m => (
              <Card key={m} className="p-4">
                <div className="font-medium">{PRESETS[m].nome}</div>
                <p className="mt-1 text-xs text-muted-foreground">{PRESETS[m].exemplo}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="pb-14">
          <h2 className="text-2xl font-bold">O que faz</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {RECURSOS.map(r => (
              <div key={r.titulo}>
                <r.icon className="h-6 w-6 text-primary" />
                <h3 className="mt-2 font-semibold">{r.titulo}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{r.texto}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="planos" className="scroll-mt-6 pb-14">
          <h2 className="text-2xl font-bold">Planos</h2>
          <p className="mt-1 text-sm text-muted-foreground">Preços em reais. No anual, 2 meses saem de graça. Sem fidelidade.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {PLANS.map(p => (
              <Card key={p.tier} className={`flex flex-col p-6 ${p.tier === "pro" ? "border-primary/50" : ""}`}>
                <h3 className="text-lg font-semibold">{p.nome}</h3>
                <p className="text-sm text-muted-foreground">{p.resumo}</p>
                <div className="mt-4">
                  <span className="text-3xl font-bold">{p.mensal === 0 ? "Grátis" : brl(p.mensal)}</span>
                  {p.mensal > 0 && <span className="text-muted-foreground">/mês</span>}
                </div>
                {p.anual > 0 && <p className="text-xs text-muted-foreground">ou {brl(p.anual)}/ano</p>}
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {p.itens.map(i => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {i}</li>)}
                </ul>
                <Button asChild className="mt-6" variant={p.tier === "pro" ? "default" : "outline"}>
                  <Link to="/entrar?criar=empresa">{p.mensal === 0 ? "Criar conta grátis" : "Testar 14 dias grátis"}</Link>
                </Button>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Pro Equipe: 5 profissionais incluídos; a partir do sexto, {brl(EXTRA_TEACHER.mensal)}/mês cada.
            Assistente com inteligência artificial disponível como adicional, sob pedido.
            Assinatura cobrada por cartão, pelo Stripe; na fatura aparece CRONYS.
          </p>
        </section>

        <section className="pb-14">
          <h2 className="text-2xl font-bold">Perguntas rápidas</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div><dt className="font-semibold">Preciso de cartão para testar?</dt><dd className="text-muted-foreground">Não. A conta nasce com 14 dias do Pro; se não assinar, passa para o Essencial, que é gratuito.</dd></div>
            <div><dt className="font-semibold">E se eu cancelar?</dt><dd className="text-muted-foreground">Cancela quando quiser, sem multa. Nada do que você cadastrou é apagado: o que passar do limite do Essencial fica pausado até você escolher o que liberar.</dd></div>
            <div><dt className="font-semibold">Meus clientes precisam pagar alguma coisa?</dt><dd className="text-muted-foreground">Não. O portal do cliente é gratuito; quem assina é a empresa.</dd></div>
            <div><dt className="font-semibold">E os dados dos meus clientes?</dt><dd className="text-muted-foreground">Cada empresa só enxerga os próprios dados - a regra está no banco de dados, não só na tela. Veja a <Link to="/privacidade" className="underline">política de privacidade</Link>.</dd></div>
          </dl>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Cronys</span>
          <nav className="flex flex-wrap gap-4">
            <Link to="/termos" className="hover:underline">Termos de uso</Link>
            <Link to="/privacidade" className="hover:underline">Privacidade</Link>
            <Link to="/excluir-conta" className="hover:underline">Excluir conta</Link>
            {contact && <a href={`mailto:${contact}`} className="hover:underline">{contact}</a>}
          </nav>
        </div>
      </footer>
    </div>
  );
}
