import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { FALLBACK_LESSON_PRICE, primeLessonPrice } from "@/hooks/useLessonPrice";
import { fmtMoney } from "@/lib/balance";
import { usePlan } from "@/hooks/usePlan";
import { Badge } from "@/components/ui/badge";
import { useWords } from "@/hooks/useVocabulary";
import { dbErrorMessage } from "@/lib/dbErrors";
import { cap } from "@/lib/vocabulary";
import VocabularySettings from "@/components/VocabularySettings";
import LanguageSettings from "@/components/LanguageSettings";
import PackagesSettings from "@/components/PackagesSettings";
import ServicesSettings from "@/components/ServicesSettings";
import GoogleCalendarSettings from "@/components/GoogleCalendarSettings";
import { Link } from "react-router-dom";
import { canSellHere } from "@/lib/subscription";

import { intlLocale, L, currencySymbol, getCurrency } from "@/lib/i18n";
// Um par de números por dia da semana, 0 = domingo.
type ScarcityDay = { min: number; max: number };
type Scarcity = Record<string, ScarcityDay>;

const DIAS = L(["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"], ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const SCARCITY_PADRAO: Scarcity = {
  "0": { min: 3, max: 7 }, "1": { min: 1, max: 3 }, "2": { min: 1, max: 3 },
  "3": { min: 1, max: 3 }, "4": { min: 1, max: 3 }, "5": { min: 1, max: 3 },
  "6": { min: 3, max: 7 },
};

type Settings = {
  work_start: string; work_end: string; slot_minutes: number;
  default_lesson_price: number;
  scarcity: Scarcity;
  pix_key: string | null; payment_link: string | null;
  contact_email: string | null;
  issuer_document: string | null;
  show_payment_info_to_students: boolean;
  allow_student_booking: boolean;
  show_availability_to_students: boolean;
  /** Só existe depois da migration 20260924080000. */
  min_request_notice_hours?: number;
  /** Falta cobrada (migration 20260925040000). */
  charge_absence?: boolean;
  absence_notice_hours?: number;
  absence_charge_percent?: number;
  /** Intervalo entre atendimentos, em minutos (migration 20260925150000). */
  buffer_minutes?: number;
};

export default function SettingsPage() {
  const { plan, loading: planLoading } = usePlan();
  const v = useWords();
  const [s, setS] = useState<Settings>({
    work_start: "08:00", work_end: "22:00", slot_minutes: 60,
    default_lesson_price: FALLBACK_LESSON_PRICE,
    scarcity: SCARCITY_PADRAO,
    pix_key: "", payment_link: "", contact_email: "", issuer_document: null,
    show_payment_info_to_students: false,
    allow_student_booking: true,
    show_availability_to_students: false,
  });
  // O banco entrega só a linha da própria empresa, então a consulta não filtra
  // por id - mas o id da linha carregada é guardado para gravar exatamente nela.
  const [rowId, setRowId] = useState<number | null>(null);
  // issuer_document vem da migration 20260923010000. Enquanto ela não estiver
  // aplicada, mandar a coluna no update faria TODO "Salvar" desta tela falhar -
  // e o front-end publica sozinho a cada merge, possivelmente antes dela.
  const [hasIssuerColumn, setHasIssuerColumn] = useState(false);
  // Mesmo cuidado para os campos de pagamento por empresa (migration
  // 20260924010000): só aparecem, e só vão no update, se a coluna existir.
  const [hasPayColumns, setHasPayColumns] = useState(false);
  useEffect(() => {
    supabase.from("settings").select("*").maybeSingle().then(({ data }) => {
      if (!data) return;
      setRowId((data as any).id);
      setHasIssuerColumn("issuer_document" in (data as any));
      setHasPayColumns("pix_receiver_name" in (data as any));
      const vindo = (data as any).scarcity as Scarcity | null;
      setS({ ...s, ...(data as any), scarcity: vindo ?? SCARCITY_PADRAO });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v || lo));

  const save = async () => {
    if (rowId === null) { toast.error(L("Configurações ainda carregando", "Settings are still loading")); return; }
    // O banco recusa valor zerado ou negativo; avisar aqui evita a mensagem
    // crua do Postgres, e a checagem de lá continua sendo a que vale.
    if (!(Number(s.default_lesson_price) > 0)) {
      toast.error(L(`O valor ${v.appointment.do} ${v.appointment.l} precisa ser maior que zero`, `The ${v.appointment.l} price must be greater than zero`));
      return;
    }
    const { id: _id, account_id: _account, issuer_document: _doc, ...rest } = s as any;
    const payload = {
      ...rest,
      default_lesson_price: Number(s.default_lesson_price),
      scarcity: Object.fromEntries(DIAS.map((_, i) => {
        const d = s.scarcity?.[String(i)] ?? SCARCITY_PADRAO[String(i)];
        const min = clamp(d.min, 1, 12);
        return [String(i), { min, max: clamp(Math.max(d.max, min), 1, 12) }];
      })),
      pix_key: (s.pix_key || "").trim() || null,
      payment_link: (s.payment_link || "").trim() || null,
      contact_email: (s.contact_email || "").trim() || null,
      ...("min_request_notice_hours" in s
        ? { min_request_notice_hours: Math.max(0, Math.min(168, Math.round(Number(s.min_request_notice_hours) || 0))) }
        : {}),
      ...("buffer_minutes" in s
        ? { buffer_minutes: Math.max(0, Math.min(240, Math.round(Number(s.buffer_minutes) || 0))) }
        : {}),
      ...("charge_absence" in s ? {
        charge_absence: !!s.charge_absence,
        absence_notice_hours: Math.max(0, Math.min(168, Math.round(Number(s.absence_notice_hours) || 0))),
        absence_charge_percent: Math.max(1, Math.min(100, Math.round(Number(s.absence_charge_percent) || 100))),
      } : {}),
      ...(hasIssuerColumn ? { issuer_document: (s.issuer_document || "").trim() || null } : {}),
      ...(hasPayColumns ? Object.fromEntries(
        ["payment_link_label", "payment_link_note", "pix_receiver_name", "pix_city"]
          .map(k => [k, (((s as any)[k] as string | null) || "").trim() || null]),
      ) : {}),
    };
    const { error } = await supabase.from("settings").update(payload).eq("id", rowId);
    if (error) toast.error(dbErrorMessage(error, v));
    else {
      setS({ ...s, ...payload } as any);
      // As outras telas leem o valor de um cache; sem isto, o diálogo de nova
      // aula continuaria abrindo com o preço antigo até recarregar a página.
      primeLessonPrice(payload.default_lesson_price);
      toast.success(L("Configurações salvas", "Settings saved"));
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold">{L("Configurações", "Settings")}</h1>
        <p className="text-sm text-muted-foreground">{L("Tipo de negócio, janela de trabalho, pagamento e contato.", "Business type, working hours, payment and contact.")}</p>
      </div>

      <LanguageSettings />

      <VocabularySettings />

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L("Janela de trabalho", "Working hours")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{L("Início do dia", "Day starts")}</Label><Input type="time" value={s.work_start.slice(0,5)} onChange={e => setS({ ...s, work_start: e.target.value })} /></div>
          <div><Label>{L("Fim do dia", "Day ends")}</Label><Input type="time" value={s.work_end.slice(0,5)} onChange={e => setS({ ...s, work_end: e.target.value })} /></div>
        </div>
        <div><Label>{L("Duração do slot (min)", "Slot length (min)")}</Label><Input type="number" value={s.slot_minutes} onChange={e => setS({ ...s, slot_minutes: Number(e.target.value) })} /></div>
        {"buffer_minutes" in s && (
          <div>
            <Label>{L(`Intervalo entre ${v.appointment.lp} (min)`, `Buffer between ${v.appointment.lp} (min)`)}</Label>
            <Input type="number" min={0} max={240} step={5} value={s.buffer_minutes ?? 0}
              onChange={e => setS({ ...s, buffer_minutes: Number(e.target.value) })} />
            <p className="mt-1 text-xs text-muted-foreground">
              {L(`Tempo livre antes e depois de cada ${v.appointment.l} (deslocamento, limpeza da sala). Os horários oferecidos no portal e na página pública respeitam esse intervalo. 0 = sem intervalo.`,
                 `Free time before and after each ${v.appointment.l} (travel, cleaning the room). Times offered in the portal and on the public page respect it. 0 = no buffer.`)}
            </p>
          </div>
        )}
      </Card>

      {!planLoading && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L("Seu plano", "Your plan")}</h2>
            <Badge variant={plan.plano === "pro" ? "default" : "outline"}>{plan.nome}</Badge>
          </div>
          {plan.plano === "pro" && plan.trial_ends_at && (
            <p className="rounded-md bg-primary/5 px-3 py-2 text-xs">
              {L("Teste grátis até", "Free trial until")} <strong>{new Date(plan.trial_ends_at).toLocaleDateString(intlLocale())}</strong>.
              {L(" Depois a conta passa para o Essencial, sem apagar nada.", " After that the account moves to Essential, without deleting anything.")}
            </p>
          )}
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">{v.staff.p}</span>
              <strong>{plan.max_teachers ?? (plan.included_teachers ? L(`${plan.included_teachers} incluídos, e mais sob cobrança`, `${plan.included_teachers} included, more at extra cost`) : L("sem limite", "unlimited"))}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">{v.client.p}</span>
              <strong>{plan.max_active_clients != null
                ? L(`${plan.active_clients ?? 0} de ${plan.max_active_clients} ativos`, `${plan.active_clients ?? 0} of ${plan.max_active_clients} active`)
                : L("ativos sem limite", "unlimited active")}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">{L("Pacotes, vouchers e desconto", "Packages, vouchers and discounts")}</span>
              <strong>{plan.packages ? L("sim", "yes") : L("não", "no")}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">{L("Bloqueio que se repete toda semana", "Weekly recurring time off")}</span>
              <strong>{plan.recurring_blocks ? L("sim", "yes") : L("não", "no")}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">{L("Nomes do seu tipo de negócio", "Words for your type of business")}</span>
              <strong>{plan.vocabulary ? L("sim", "yes") : L("não (genéricos)", "no (generic)")}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">{L("Assistente", "Assistant")}</span>
              <strong>
                {plan.assistant
                  ? L(`sim (${plan.assistant_usage?.limit ?? plan.assistant_messages ?? 0} mensagens/mês)`, `yes (${plan.assistant_usage?.limit ?? plan.assistant_messages ?? 0} messages/month)`)
                  : plan.assistant_addon ? L("como adicional", "as an add-on")
                    : L("não", "no")}
              </strong>
            </li>
          </ul>
          {plan.billing_status === "active" && plan.paid_until && (
            <p className="text-xs text-muted-foreground">
              {L(`Assinatura ${plan.billing_interval === "year" ? "anual" : "mensal"} ativa, renova em ${new Date(plan.paid_until).toLocaleDateString(intlLocale())}.`,
                 `${plan.billing_interval === "year" ? "Yearly" : "Monthly"} subscription active, renews on ${new Date(plan.paid_until).toLocaleDateString(intlLocale())}.`)}
              {(plan.extra_teachers ?? 0) > 0 && L(` Inclui ${plan.extra_teachers} ${plan.extra_teachers === 1 ? v.staff.l : v.staff.lp} a mais.`, ` Includes ${plan.extra_teachers} extra ${plan.extra_teachers === 1 ? v.staff.l : v.staff.lp}.`)}
            </p>
          )}
          {plan.billing_status === "past_due" && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {L("O pagamento da assinatura não passou.", "The subscription payment failed.")}
              {plan.grace_until && L(` Se não for acertado até ${new Date(plan.grace_until).toLocaleDateString(intlLocale())}, a conta passa para o Essencial (nada é apagado).`,
                ` If it isn't sorted out by ${new Date(plan.grace_until).toLocaleDateString(intlLocale())}, the account moves to Essential (nothing is deleted).`)}
            </p>
          )}
          {plan.plano !== "pro" && (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              {L("O que você já cadastrou continua aqui, sempre. Os limites valem só para cadastrar coisa nova.",
                 "Everything you already added stays here, always. Limits only apply to adding new things.")}
              {!canSellHere() && L(" Para mudar de plano, fale com quem cuida da sua conta.", " To change plans, contact whoever manages your account.")}
            </p>
          )}
          {/* Só no site: no app a Google Play não deixa vender nem apontar para
              onde se compra (ver lib/subscription.ts). */}
          {canSellHere() && (
            <Button asChild variant={plan.billing_status === "active" ? "outline" : "default"} className="w-full">
              <Link to="/assinar">
                {plan.billing_status === "active" || plan.billing_status === "past_due" ? L("Gerenciar assinatura", "Manage subscription") : L("Ver planos e assinar", "See plans and subscribe")}
              </Link>
            </Button>
          )}
        </Card>
      )}

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L(`Valor ${v.appointment.do} ${v.appointment.l}`, `${v.appointment.s} price`)}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {L(`Quanto custa uma hora de ${v.appointment.l}. É com este valor que ${v.appointment.pick("todo", "toda")} ${v.appointment.l} ${v.appointment.pick("novo", "nova")} nasce — na agenda, no portal e no assistente.`,
               `How much one hour of ${v.appointment.l} costs. Every new ${v.appointment.l} starts with this price — in the calendar, the portal and the assistant.`)}
          </p>
        </div>
        <div>
          <Label>{L("Valor por hora", "Hourly rate")} ({currencySymbol()}/h)</Label>
          <Input
            type="number"
            min={1}
            step="0.01"
            inputMode="decimal"
            value={s.default_lesson_price}
            onChange={e => setS({ ...s, default_lesson_price: Number(e.target.value) })}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            {L(`${cap(v.appointment.um)} ${v.appointment.l} de 1 hora sai por `, `A 1-hour ${v.appointment.l} costs `)}
            <strong className="text-foreground">{fmtMoney(Number(s.default_lesson_price) || 0)}</strong>;
            {L(` ${v.appointment.um} de 90 min, por `, ` a 90-minute one, `)}
            <strong className="text-foreground">{fmtMoney((Number(s.default_lesson_price) || 0) * 1.5)}</strong>.
          </p>
        </div>
        <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          {L(<>Mudar aqui vale para {v.appointment.os} <strong className="text-foreground">{v.appointment.pick("próximos", "próximas")}</strong> {v.appointment.lp}.
          {" "}{cap(v.appointment.os)} que já estão na agenda ficam com o valor que tinham — para mudar {v.appointment.um}{" "}
          {v.appointment.pick("deles", "delas")}, abra {v.appointment.o} {v.appointment.l} e edite o valor. Para cobrar menos de {v.guardian.um} {v.guardian.l}{" "}
          sem mexer no valor {v.appointment.do} {v.appointment.l}, use <strong className="text-foreground">Desconto</strong> na
          tela Financeiro.</>,
          <>Changes here apply to <strong className="text-foreground">upcoming</strong> {v.appointment.lp}. {v.appointment.p} already on the calendar keep their price —
          to change one, open it and edit the price. To charge a {v.guardian.l} less without changing the {v.appointment.l} price, use
          <strong className="text-foreground"> Discount</strong> on the Billing page.</>)}
        </p>
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L("Pagamento", "Payment")}</h2>
        {/* Pix só existe no Brasil, em reais. */}
        {getCurrency() === "BRL" && <div>
          <Label>Chave Pix</Label>
          <Input value={s.pix_key ?? ""} onChange={e => setS({ ...s, pix_key: e.target.value })} placeholder="CPF, CNPJ, e-mail, +55 celular ou chave aleatória" />
          <p className="text-xs text-muted-foreground mt-1">Celular com +55 na frente - sem ele, 11 números são lidos como CPF.</p>
        </div>}
        {hasPayColumns && getCurrency() === "BRL" && (
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Nome de quem recebe</Label><Input value={(s as any).pix_receiver_name ?? ""} onChange={e => setS({ ...s, pix_receiver_name: e.target.value } as any)} placeholder="Como está no banco" /></div>
            <div><Label>Cidade</Label><Input value={(s as any).pix_city ?? ""} onChange={e => setS({ ...s, pix_city: e.target.value } as any)} placeholder="Ex.: São Paulo" /></div>
            <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
              Com nome e cidade, a cobrança e o portal levam o <strong>Pix copia e cola já com o valor</strong> - {v.guardian.o} {v.guardian.l} só cola no app do banco.
            </p>
          </div>
        )}
        <div><Label>{L("Link de pagamento", "Payment link")}</Label><Input value={s.payment_link ?? ""} onChange={e => setS({ ...s, payment_link: e.target.value })} placeholder="https://..." /></div>
        {hasPayColumns && (
          <>
            <div><Label>{L("Nome do link", "Link name")}</Label><Input value={(s as any).payment_link_label ?? ""} onChange={e => setS({ ...s, payment_link_label: e.target.value } as any)} placeholder={L("Ex.: InfinitePay, Mercado Pago", "E.g. Stripe, PayPal, Square")} /></div>
            <div><Label>{L("Texto que acompanha o link", "Text shown with the link")}</Label><Input value={(s as any).payment_link_note ?? ""} onChange={e => setS({ ...s, payment_link_note: e.target.value } as any)} placeholder={L("Ex.: cartão em até 12x, boleto ou Pix", "E.g. credit card or bank transfer")} /></div>
          </>
        )}
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label className="cursor-pointer">{L("Exibir dados de pagamento no portal", "Show payment details in the portal")}</Label>
            <p className="text-xs text-muted-foreground">{L("Mostra PIX e link de pagamento no portal.", "Shows the payment link in the portal.")}</p>
          </div>
          <Switch checked={s.show_payment_info_to_students} onCheckedChange={v => setS({ ...s, show_payment_info_to_students: v })} />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L("Contato", "Contact")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {L("Aparece na página pública de privacidade, que a Play Store exige. Em branco, a página pede para quem lê falar direto com você, em vez de mostrar um e-mail que não é seu.",
               "Shown on the public privacy page. If empty, the page asks readers to contact you directly instead of showing an email that isn't yours.")}
          </p>
        </div>
        <div>
          <Label>{L("E-mail de contato", "Contact email")}</Label>
          <Input
            type="email"
            value={s.contact_email ?? ""}
            onChange={e => setS({ ...s, contact_email: e.target.value })}
            placeholder={L("seu@email.com", "you@email.com")}
          />
        </div>
        {hasIssuerColumn && <div>
          <Label>{L("CPF ou CNPJ", "Tax ID")}</Label>
          <Input
            value={s.issuer_document ?? ""}
            onChange={e => setS({ ...s, issuer_document: e.target.value })}
            placeholder={L("000.000.000-00", "")}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {L("Impresso nos recibos, em Relatórios. Em branco, o recibo sai com a linha vazia para preencher à mão.", "Printed on receipts (Reports). If empty, the receipt leaves the line blank to fill in by hand.")}
          </p>
        </div>}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L(`Portal ${v.client.do} ${v.client.s}`, `${v.client.s} portal`)}</h2>
        {plan.school_code && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0">
              <Label>{L(`Código ${v.business.do} ${v.business.l}`, `${v.business.s} code`)}</Label>
              <p className="text-xs text-muted-foreground">
                {L(`Quem baixar o app e criar a conta sozinho digita este código para entrar ${v.business.no} ${v.business.seu} ${v.business.l}. Depois você liga o cadastro ${v.client.ao} ${v.client.l} em Acessos.`,
                   `Anyone who downloads the app and signs up on their own types this code to join your ${v.business.l}. Then you link them to the ${v.client.l} profile in Access.`)}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0 font-mono"
              onClick={() => { navigator.clipboard.writeText(plan.school_code!); toast.success(L("Código copiado", "Code copied")); }}>
              {plan.school_code}
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label className="cursor-pointer">{L(`Permitir que ${v.client.lp} agendem ${v.appointment.lp} diretamente`, `Let ${v.client.lp} request ${v.appointment.lp} directly`)}</Label>
            <p className="text-xs text-muted-foreground">{L("Quando desligado, o portal fica apenas para visualização.", "When off, the portal is view-only.")}</p>
          </div>
          <Switch checked={s.allow_student_booking} onCheckedChange={v => setS({ ...s, allow_student_booking: v })} />
        </div>
        {"min_request_notice_hours" in s && s.allow_student_booking && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div>
              <Label htmlFor="antecedencia">{L("Antecedência mínima dos pedidos (horas)", "Minimum notice for requests (hours)")}</Label>
              <p className="text-xs text-muted-foreground">
                {L(`Vale para pedir horário e para pedir troca: com 24, ninguém pede para amanhã cedo nem troca ${v.appointment.o} ${v.appointment.l} de amanhã pelo portal - precisa falar com você. 0 = sem mínimo.`,
                   `Applies to new requests and reschedules: with 24, nobody can request tomorrow morning or move tomorrow's ${v.appointment.l} through the portal - they have to talk to you. 0 = no minimum.`)}
              </p>
            </div>
            <Input id="antecedencia" type="number" min={0} max={168} className="w-20 shrink-0"
              value={s.min_request_notice_hours ?? 0}
              onChange={e => setS({ ...s, min_request_notice_hours: Number(e.target.value) })} />
          </div>
        )}
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label className="cursor-pointer">{L(`Exibir disponibilidade ${v.staff.dos} ${v.staff.lp} no portal`, `Show ${v.staff.lp}' availability in the portal`)}</Label>
            <p className="text-xs text-muted-foreground">{L(`Mostra os links de agenda ${v.staff.dos} ${v.staff.lp} no portal.`, `Shows the ${v.staff.lp}' availability links in the portal.`)}</p>
          </div>
          <Switch checked={s.show_availability_to_students} onCheckedChange={v => setS({ ...s, show_availability_to_students: v })} />
        </div>
      </Card>

      {"charge_absence" in s && (
        <Card className="p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L("Falta e desmarcação em cima da hora", "No-shows and late cancellations")}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {L(`Ligado, ${v.appointment.o} ${v.appointment.l} que ${v.client.o} ${v.client.l} desmarcar com pouca antecedência (ou em que não aparecer) pode ser ${v.appointment.pick("cobrado", "cobrada")}: ao editar ${v.appointment.o} ${v.appointment.l}, aparece o botão "Cobrar como falta". Nada é cobrado sozinho - você decide em cada caso.`,
                 `When on, a ${v.appointment.l} the ${v.client.l} cancels late (or doesn't show up for) can be charged: when editing the ${v.appointment.l}, a "Charge as no-show" button appears. Nothing is charged automatically - you decide each time.`)}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <Label htmlFor="cobra-falta" className="cursor-pointer">{L("Cobrar falta", "Charge no-shows")}</Label>
            <Switch id="cobra-falta" checked={!!s.charge_absence} onCheckedChange={on => setS({ ...s, charge_absence: on })} />
          </div>
          {s.charge_absence && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="falta-horas">{L("Desmarcou com menos de (horas)", "Canceled with less than (hours)")}</Label>
                <Input id="falta-horas" type="number" min={0} max={168} value={s.absence_notice_hours ?? 24}
                  onChange={e => setS({ ...s, absence_notice_hours: Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="falta-pct">{L("Cobra quanto do valor (%)", "Charge this much of the price (%)")}</Label>
                <Input id="falta-pct" type="number" min={1} max={100} value={s.absence_charge_percent ?? 100}
                  onChange={e => setS({ ...s, absence_charge_percent: Number(e.target.value) })} />
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="flex items-center justify-between gap-3 p-5">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L("Mensagens do WhatsApp", "WhatsApp messages")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{L(`Lembrete, confirmação, "estou a caminho" e cobrança, com o seu jeito de falar.`, `Reminder, confirmation, "on my way" and payment request, in your own words.`)}</p>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0"><Link to="/admin/mensagens">{L("Configurar mensagens", "Edit messages")}</Link></Button>
      </Card>

      <GoogleCalendarSettings />

      <ServicesSettings />

      {plan.packages && <PackagesSettings />}

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L("Escassez na página pública", "Scarcity on the public page")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {L("Quantos horários livres aparecem por dia. O app sorteia um número entre o mínimo e o máximo, então a página não mostra a agenda inteira.",
               "How many free times show per day. The app picks a number between the minimum and maximum, so the page never shows your whole calendar.")}
          </p>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 items-center">
            <span />
            <Label className="text-xs text-muted-foreground text-center">{L("Mínimo", "Min")}</Label>
            <Label className="text-xs text-muted-foreground text-center">{L("Máximo", "Max")}</Label>
          </div>
          {DIAS.map((nome, i) => {
            const d = s.scarcity?.[String(i)] ?? SCARCITY_PADRAO[String(i)];
            const set = (campo: "min" | "max", valor: number) =>
              setS({ ...s, scarcity: { ...s.scarcity, [String(i)]: { ...d, [campo]: valor } } });
            return (
              <div key={i} className="grid grid-cols-[1fr_5rem_5rem] gap-2 items-center">
                <Label className="text-sm">{nome}</Label>
                <Input type="number" min={1} max={12} value={d.min} onChange={e => set("min", Number(e.target.value))} />
                <Input type="number" min={1} max={12} value={d.max} onChange={e => set("max", Number(e.target.value))} />
              </div>
            );
          })}
        </div>
      </Card>

      <Button onClick={save}>{L("Salvar", "Save")}</Button>
    </div>
  );
}
