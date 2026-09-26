import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Check, HandCoins, QrCode, Smartphone, Users, CalendarClock, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CronysWordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { presetFor, BUSINESS_MODELS } from "@/lib/vocabulary";
import { PLANS, COUPONS_AVAILABLE, money, itemPrice, TRIAL_DAYS, ACTIVE_CLIENT_DAYS } from "@/lib/subscription";
import { PlanComparison } from "@/components/PlanComparison";
import { ANNUAL_MONTHS_CHARGED, PLANS as PLAN_CFG } from "@shared/plans";
import { isEnglish, toggleLanguage, L } from "@/lib/i18n";
import { CurrencyPicker } from "@/components/CurrencyPicker";

const RECURSOS_EN = [
  { icon: CalendarDays, titulo: "A calendar that prevents double-booking", texto: "Taken times are refused instantly, even when two requests arrive together. One-off and weekly blocks." },
  { icon: CalendarClock, titulo: "Clients request, you approve", texto: "A portal where clients or families see free times, request a slot or a change, and follow what's booked." },
  { icon: HandCoins, titulo: "Who owes what, and since when", texto: "Every completed appointment becomes a charge automatically. Packages, vouchers, family discounts, receipts and reports." },
  { icon: QrCode, titulo: "Payment requests in one tap", texto: "The payment message goes out with the total and your payment link." },
  { icon: Users, titulo: "Team with their own logins", texto: "Each professional sees their own calendar. Billing and settings stay with the admins." },
  { icon: Smartphone, titulo: "On your phone and computer", texto: "Android app and web app, with the same data." },
];

const RECURSOS_PT = [
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
  const RECURSOS = L(RECURSOS_PT, RECURSOS_EN);
  useEffect(() => {
    document.title = L("Cronys — agenda, clientes e cobrança para quem atende com hora marcada", "Cronys — scheduling, clients and billing for appointment-based businesses");
    supabase.from("settings").select("contact_email").maybeSingle()
      .then(({ data }) => setContact(((data as { contact_email?: string } | null)?.contact_email ?? "").trim() || null));
  }, []);

  return (
    <div className="flex-1 bg-background">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <CronysWordmark tamanho="1.5rem" className="text-brand-ink" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1 text-sidebar-foreground/80 hover:bg-white/10 hover:text-sidebar-foreground"
              onClick={() => { toggleLanguage(); }}>
              <Globe className="h-4 w-4" /> {isEnglish() ? "Português" : "English"}
            </Button>
            <Button asChild variant="ghost" className="text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground">
              <Link to="/entrar">{L("Entrar", "Sign in")}</Link>
            </Button>
          </div>
        </div>
        <div className="relative mx-auto max-w-5xl overflow-hidden px-4 pb-16 pt-10">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-10 h-64 w-64 rounded-full bg-brand-gold/12 blur-3xl" />
          <h1 className="relative max-w-2xl text-3xl font-bold leading-tight tracking-tight md:text-5xl">
            {L("Agenda, clientes e cobrança para quem atende com hora marcada.", "Scheduling, clients and billing for appointment-based businesses.")}
          </h1>
          <p className="relative mt-4 max-w-xl text-sidebar-foreground/75 md:text-lg">
            {L("Aulas particulares, clínicas, consultórios, salões, pet shops, estúdios e oficinas. O app fala a língua do seu ramo.",
              "Private tutors, clinics, therapists, salons, pet groomers, studios and workshops. The app speaks your industry's language.")}
          </p>
          <div className="relative mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-xl"><Link to="/entrar?criar=empresa">{L(`Começar - ${TRIAL_DAYS} dias do Pro grátis`, `Get started - ${TRIAL_DAYS} days of Pro free`)}</Link></Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl border-white/30 bg-transparent text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground">
              <a href="#planos">{L("Ver planos", "See plans")}</a>
            </Button>
          </div>
          <p className="relative mt-3 text-xs text-sidebar-foreground/60">{L("Sem cartão para testar. Depois do teste, continua de graça no Essencial.", "No card needed to try. After the trial, it stays free on Essential.")}</p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-14">
          <h2 className="text-2xl font-bold">{L("Para quem", "Who it's for")}</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {BUSINESS_MODELS.filter(m => m !== "outro").map(m => (
              <Card key={m} className="p-4">
                <div className="font-medium">{presetFor(m).nome}</div>
                <p className="mt-1 text-xs text-muted-foreground">{presetFor(m).exemplo}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="pb-14">
          <h2 className="text-2xl font-bold">{L("O que faz", "What it does")}</h2>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold">{L("Planos", "Plans")}</h2>
            <CurrencyPicker />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <b className="text-foreground">{L("Sem fidelidade.", "No commitment.")}</b>{" "}
            {COUPONS_AVAILABLE ? L("Preços em reais. ", "Prices in Brazilian reais (BRL). ") : ""}
            {L(`No anual, ${12 - ANNUAL_MONTHS_CHARGED} meses grátis.`, `Yearly: ${12 - ANNUAL_MONTHS_CHARGED} months free.`)}
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map(p => (
              <Card key={p.tier} className={`flex flex-col p-6 ${p.tier === "pro_solo" ? "border-primary/50" : ""}`}>
                <h3 className="text-lg font-semibold">{p.nome}</h3>
                <p className="text-sm text-muted-foreground">{p.resumo}</p>
                <div className="mt-4">
                  <span className="text-3xl font-bold">{p.mensal === 0 ? L("Grátis", "Free") : money(p.mensal)}</span>
                  {p.mensal > 0 && <span className="text-muted-foreground">{L("/mês", "/month")}</span>}
                </div>
                {p.anual > 0 && <p className="text-xs text-muted-foreground">{L(`ou ${money(p.anual)}/ano à vista (equivale a ${money(p.anualMes)}/mês)`, `or ${money(p.anual)}/year (works out to ${money(p.anualMes)}/month)`)}</p>}
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {p.itens.map(i => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {i}</li>)}
                </ul>
                <Button asChild className="mt-6" variant={p.tier === "pro_solo" ? "default" : "outline"}>
                  <Link to="/entrar?criar=empresa">{p.mensal === 0 ? L("Criar conta grátis", "Create a free account") : p.tier === "pro_solo" ? L(`Testar ${TRIAL_DAYS} dias grátis`, `Try ${TRIAL_DAYS} days free`) : L("Começar pelo teste do Pro", "Start with the Pro trial")}</Link>
                </Button>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {L(`Cliente ativo é quem tem atendimento nos últimos ${ACTIVE_CLIENT_DAYS} dias ou algum marcado; cadastrar é livre. Profissional extra: ${money(itemPrice("extra", "month"))}/mês cada (Pro até ${PLAN_CFG.pro_solo.maxTeachers}; Max a partir do ${PLAN_CFG.pro.includedTeachers + 1}º). O teste grátis de ${TRIAL_DAYS} dias é do Pro. O anual é cobrado de uma vez. Assinatura por cartão, pelo Stripe; na fatura aparece CRONYS.`,
              `An active client has an appointment in the last ${ACTIVE_CLIENT_DAYS} days or one booked; adding clients is free. Extra professional: ${money(itemPrice("extra", "month"))}/month each (Pro up to ${PLAN_CFG.pro_solo.maxTeachers}; Max from the ${PLAN_CFG.pro.includedTeachers + 1}th). The ${TRIAL_DAYS}-day free trial is for Pro. Yearly plans are billed upfront. Billed by card via Stripe; your statement shows CRONYS.`)}
          </p>
          <div className="mt-8"><PlanComparison interval="month" /></div>
        </section>

        <section className="pb-14">
          <h2 className="text-2xl font-bold">{L("Perguntas rápidas", "Quick questions")}</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div><dt className="font-semibold">{L("Preciso de cartão para testar?", "Do I need a card to try it?")}</dt><dd className="text-muted-foreground">{L(`Não. A conta nasce com ${TRIAL_DAYS} dias do Pro; se não assinar, passa para o Essencial, que é gratuito.`, `No. New accounts get ${TRIAL_DAYS} days of Pro; if you don't subscribe, you move to Essential, which is free.`)}</dd></div>
            <div><dt className="font-semibold">{L("E se eu cancelar?", "What if I cancel?")}</dt><dd className="text-muted-foreground">{L("Cancela quando quiser, sem multa. Nada do que você cadastrou é apagado: seus clientes continuam acessíveis; só não entram clientes novos acima do limite do plano, e você escolhe quais profissionais ficam ativos.", "Cancel anytime, no fees. Nothing you saved is deleted: your clients stay accessible; you just can't add new active clients over the plan limit, and you choose which professionals stay active.")}</dd></div>
            <div><dt className="font-semibold">{L("Meus clientes precisam pagar alguma coisa?", "Do my clients pay anything?")}</dt><dd className="text-muted-foreground">{L("Não. O portal do cliente é gratuito; quem assina é a empresa.", "No. The client portal is free; only the business subscribes.")}</dd></div>
            <div><dt className="font-semibold">{L("E os dados dos meus clientes?", "What about my clients' data?")}</dt><dd className="text-muted-foreground">{L("Cada empresa só enxerga os próprios dados - a regra está no banco de dados, não só na tela. Veja a", "Each business only sees its own data - the rule is enforced in the database, not just the screen. See the")} <Link to="/privacidade" className="underline">{L("política de privacidade", "privacy policy")}</Link>.</dd></div>
          </dl>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Cronys</span>
          <nav className="flex flex-wrap gap-4">
            <Link to="/termos" className="hover:underline">{L("Termos de uso", "Terms of use")}</Link>
            <Link to="/privacidade" className="hover:underline">{L("Privacidade", "Privacy")}</Link>
            <Link to="/excluir-conta" className="hover:underline">{L("Excluir conta", "Delete account")}</Link>
            {contact && <a href={`mailto:${contact}`} className="hover:underline">{contact}</a>}
          </nav>
        </div>
      </footer>
    </div>
  );
}
