import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowDownUp, Check, ChevronDown, ChevronRight, CircleDollarSign, Gift, MoreVertical, Package, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWords } from "@/hooks/useVocabulary";
import { fmtMoney, capitalize } from "@/lib/balance";
import { haptics } from "@/lib/haptics";
import { dateLocale, intlLocale, L } from "@/lib/i18n";
import { lessonsLeftIn, packageSlots, type AccountLedger as Ledger, type LedgerCharge, type LedgerPackage, type LedgerSource } from "@/lib/ledger";
import { cn } from "@/lib/utils";

/**
 * O que está dentro de uma conta no Financeiro (08/10), em três abas:
 * - Aulas: cada uma na ordem da data, com o que a pagou (ou quanto falta);
 * - Pagamentos: cada pagamento ou pacote e as aulas que ele abateu;
 * - Extrato: tudo junto, com o saldo depois de cada linha.
 * O portal do cliente usa a mesma tela, sem os botões de editar.
 */
type Order = "new" | "old";
const ORDER_KEY = "cronys.ledger.order";

function useOrder() {
  const [order, setOrder] = useState<Order>(() => { try { return localStorage.getItem(ORDER_KEY) === "old" ? "old" : "new"; } catch { return "new"; } });
  const toggle = () => {
    const next: Order = order === "new" ? "old" : "new";
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, next); } catch { /* ok */ }
  };
  return { order, toggle };
}

const day = (iso: string) => format(new Date(iso), L("EEE, dd/MM/yy", "EEE, MMM d, yy"), { locale: dateLocale() });
const dayTime = (iso: string) => format(new Date(iso), L("EEE, dd/MM · HH:mm", "EEE, MMM d · h:mm a"), { locale: dateLocale() });
const shortDay = (iso: string) => format(new Date(iso), L("dd/MM", "MMM d"), { locale: dateLocale() });

export type LedgerActions = {
  onEditLesson?: (lessonId: string) => void;
  onDeleteLesson?: (lessonId: string) => void;
  onEditTx?: (txId: string) => void;
  onDeleteTx?: (txId: string) => void;
  /** Descrição e valor de cada lançamento (para os botões de editar um pacote). */
  txInfo?: (txId: string) => { amount: number; kind: string; description: string | null } | undefined;
  /** Excluir a compra de um pacote por aulas. */
  onDeletePurchase?: (purchaseId: string) => void;
};

const fmtSessions = (n: number) => n.toLocaleString(intlLocale(), { maximumFractionDigits: 2 });

export default function AccountLedger({ ledger, actions, defaultTab = "lessons" }: { ledger: Ledger; actions?: LedgerActions; defaultTab?: "lessons" | "payments" | "statement" }) {
  const w = useWords();
  const ap = w.appointment;
  const { order, toggle } = useOrder();
  const sourceById = useMemo(() => new Map(ledger.sources.map(s => [s.id, s])), [ledger.sources]);
  const chargeById = useMemo(() => new Map(ledger.charges.map(c => [c.id, c])), [ledger.charges]);
  const sorted = <T,>(list: T[]) => (order === "new" ? [...list].reverse() : list);

  const OrderButton = (
    <button type="button" onClick={() => { haptics.tap(); toggle(); }}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
      <ArrowDownUp className="h-3 w-3" /> {order === "new" ? L("Mais recentes primeiro", "Newest first") : L("Mais antigas primeiro", "Oldest first")}
    </button>
  );

  // ---- Aulas, por mês ----
  // A venda de um pacote é uma cobrança, mas não é aula: aparece no cartão do pacote.
  const lessonCharges = useMemo(() => ledger.charges.filter(c => !c.packageSale), [ledger.charges]);
  const months = useMemo(() => {
    const map = new Map<string, LedgerCharge[]>();
    for (const c of lessonCharges) {
      const k = c.date.slice(0, 7);
      map.set(k, [...(map.get(k) ?? []), c]);
    }
    return [...map.entries()];
  }, [lessonCharges]);

  const paidByText = (c: LedgerCharge) => {
    const srcs = c.paidBy.map(p => sourceById.get(p.sourceId)).filter((s): s is LedgerSource => !!s);
    if (!srcs.length) return null;
    if (srcs.length === 1) return `${srcs[0].label} · ${shortDay(srcs[0].date)}`;
    return srcs.map(s => s.label).join(" + ");
  };

  const statusBadge = (c: LedgerCharge) =>
    c.status === "package" ? (
      <Badge className="gap-1 border-transparent bg-primary/15 text-primary hover:bg-primary/15"><Package className="h-3 w-3" />{L("Pacote", "Package")}</Badge>
    ) : c.status === "paid" ? (
      <Badge className="gap-1 border-transparent bg-success/15 text-success hover:bg-success/15"><Check className="h-3 w-3" />{L("Pago", "Paid")}</Badge>
    ) : c.status === "partial" ? (
      <Badge className="border-transparent bg-warning/15 text-warning hover:bg-warning/15">{L(`Faltam ${fmtMoney(c.open)}`, `${fmtMoney(c.open)} left`)}</Badge>
    ) : (
      <Badge variant="destructive">{L("Em aberto", "Open")}</Badge>
    );

  const rowMenu = (c: LedgerCharge) => {
    if (!actions) return null;
    const edit = c.lessonId ? actions.onEditLesson && (() => actions.onEditLesson!(c.lessonId!)) : actions.onEditTx && (() => actions.onEditTx!(c.txId));
    const del = c.lessonId ? actions.onDeleteLesson && (() => actions.onDeleteLesson!(c.lessonId!)) : actions.onDeleteTx && (() => actions.onDeleteTx!(c.txId));
    if (!edit && !del) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="-my-1 h-7 w-7 shrink-0" aria-label={L("Opções", "Options")}><MoreVertical className="h-3.5 w-3.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-xl">
          {edit && <DropdownMenuItem onClick={edit}><Pencil className="mr-2 h-4 w-4" />{c.lessonId ? L(`Editar ${ap.l}`, `Edit ${ap.l}`) : L("Editar lançamento", "Edit entry")}</DropdownMenuItem>}
          {del && <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={del}><Trash2 className="mr-2 h-4 w-4" />{c.lessonId ? L(`Excluir ${ap.l}`, `Delete ${ap.l}`) : L("Remover lançamento", "Remove entry")}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const usesText = (c: LedgerCharge) => c.packageUses.map(u => {
    const { first, last } = packageSlots(u);
    const n = last > first ? L(`${ap.lp} ${first} e ${last}`, `${ap.lp} ${first}-${last}`) : `${ap.l} ${first}`;
    return `${u.label} · ${n} ${L("de", "of")} ${fmtSessions(u.total)}`;
  }).join(" + ");

  const lessonsTab = lessonCharges.length === 0 ? (
    <p className="py-3 text-sm text-muted-foreground">{L(`${ap.nenhum} ${ap.l} ${ap.pick("realizado", "realizada")} ainda.`, `No completed ${ap.lp} yet.`)}</p>
  ) : (
    <div className="space-y-3">
      <div className="flex justify-end">{OrderButton}</div>
      {sorted(months).map(([month, list]) => {
        const open = list.reduce((s, c) => s + c.open, 0);
        return (
          <section key={month}>
            <div className="mb-1 flex items-baseline justify-between gap-2 px-1 text-xs">
              <span className="whitespace-nowrap font-semibold">{capitalize(format(new Date(`${month}-15T12:00:00`), L("MMMM 'de' yyyy", "MMMM yyyy"), { locale: dateLocale() }))}</span>
              <span className="text-right text-muted-foreground">
                {list.length} {list.length === 1 ? ap.l : ap.lp}
                {open > 0 ? L(` · ${fmtMoney(open)} em aberto`, ` · ${fmtMoney(open)} open`) : L(" · tudo pago", " · all paid")}
              </span>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {sorted(list).map(c => {
                const by = paidByText(c);
                return (
                  <li key={c.id} className="px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", c.status === "package" ? "bg-primary" : c.status === "paid" ? "bg-success" : c.status === "partial" ? "bg-warning" : "bg-destructive")} />
                      <span className="min-w-0 flex-1 truncate capitalize">{c.manual ? day(c.date) : dayTime(c.date)}</span>
                      {c.status === "package" ? (
                        <span className="shrink-0 text-xs font-medium text-primary" title={c.fullValue != null ? L(`Avuls${ap.pick("o", "a")} sairia ${fmtMoney(c.fullValue)}`, `Single would be ${fmtMoney(c.fullValue)}`) : undefined}>
                          {L("no pacote", "in package")}
                        </span>
                      ) : (
                        <span className="shrink-0 font-medium tabular-nums">
                          {c.discount > 0 && <span className="mr-1 text-[11px] font-normal text-muted-foreground line-through">{fmtMoney(c.gross)}</span>}
                          {fmtMoney(c.net)}
                        </span>
                      )}
                      {rowMenu(c)}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 pl-4">
                      <span className="min-w-0 truncate text-xs text-muted-foreground">{c.detail}{c.manual ? L(" · lançamento manual", " · manual entry") : ""}</span>
                      {statusBadge(c)}
                    </div>
                    {c.packageUses.length > 0 && (
                      <div className="truncate pl-4 text-[11px] font-medium text-primary">{usesText(c)}</div>
                    )}
                    {c.discount > 0 && (
                      <div className="truncate pl-4 text-[11px] text-success">−{fmtMoney(c.discount)} · {c.discountLabel ?? L("desconto", "discount")}</div>
                    )}
                    {by && (
                      <div className="truncate pl-4 text-[11px] text-muted-foreground">
                        {c.status === "paid" ? L("Pago com ", "Paid with ") : L("Parte paga com ", "Partly paid with ")}{by}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );

  // ---- Pagamentos e pacotes ----
  const [openSource, setOpenSource] = useState<Record<string, boolean>>({});
  const sourceIcon = (s: LedgerSource) => s.kind === "package" ? Package : s.kind === "payment" ? CircleDollarSign : Gift;
  const packageCard = (p: LedgerPackage) => {
    const pct = p.sessions > 0 ? Math.round((p.used / p.sessions) * 100) : 0;
    const sale = p.saleChargeId ? chargeById.get(p.saleChargeId) : undefined;
    const isOpen = !!openSource[p.id];
    return (
      <div key={p.id} className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><Package className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium">{p.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtSessions(p.sessions)} {p.sessions === 1 ? ap.l : ap.lp}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="capitalize">{day(p.created_at)}</span>
              <span>· {fmtSessions(p.minutes)} min {L(`cada`, `each`)}</span>
              {p.converted ? <span>· {L("convertido do saldo antigo", "converted from old balance")}</span>
                : sale ? (
                  sale.status === "paid" ? <span className="text-success">· {fmtMoney(p.price)} {L("pago", "paid")}</span>
                    : <span className="text-destructive">· {L(`falta pagar ${fmtMoney(sale.open)}`, `${fmtMoney(sale.open)} to pay`)}</span>
                ) : null}
            </div>
            <Progress value={pct} className="mt-2 h-2" aria-label={L(`${pct}% usado`, `${pct}% used`)} />
            <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-muted-foreground">
              <span>{L(`${fmtSessions(p.used)} de ${fmtSessions(p.sessions)} usadas`, `${fmtSessions(p.used)} of ${fmtSessions(p.sessions)} used`)}</span>
              <span className={p.left > 0 ? "font-semibold text-primary" : ""}>
                {p.left > 0 ? L(`Restam ${fmtSessions(p.left)} ${p.left === 1 ? ap.l : ap.lp}`, `${fmtSessions(p.left)} ${p.left === 1 ? ap.l : ap.lp} left`) : L("Pacote encerrado", "Package used up")}
              </span>
            </div>
            {(p.lessons.length > 0 || actions?.onDeletePurchase) && (
              <button type="button" onClick={() => { haptics.tap(); setOpenSource(o => ({ ...o, [p.id]: !isOpen })); }}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {isOpen ? L("Esconder", "Hide") : p.lessons.length > 0 ? L(`Ver ${ap.os} ${ap.lp} do pacote`, `See the package's ${ap.lp}`) : L("Detalhes", "Details")}
              </button>
            )}
            {isOpen && (
              <div className="mt-2 space-y-2">
                {p.lessons.length > 0 && (
                  <ul className="space-y-1 rounded-lg bg-muted/50 p-2 text-xs">
                    {p.lessons.map(u => {
                      const c = chargeById.get(u.chargeId);
                      if (!c) return null;
                      const { first, last } = packageSlots(u);
                      return (
                        <li key={u.chargeId} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate"><span className="font-semibold tabular-nums text-primary">{last > first ? `${first}-${last}` : first}.</span> <span className="capitalize">{dayTime(c.date)}</span> · <span className="text-muted-foreground">{c.detail}</span></span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{u.sessions === 1 ? "" : `${fmtSessions(u.sessions)} ${u.sessions < 1 ? ap.l : ap.lp}`}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {actions?.onDeletePurchase && (
                  <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-lg text-xs text-destructive hover:text-destructive" onClick={() => actions.onDeletePurchase!(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" /> {L("Excluir esta compra do pacote", "Delete this package purchase")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const paymentsTab = ledger.sources.length === 0 && ledger.packages.length === 0 ? (
    <p className="py-3 text-sm text-muted-foreground">{L("Nenhum pagamento ainda.", "No payments yet.")}</p>
  ) : (
    <div className="space-y-2">
      <div className="flex justify-end">{OrderButton}</div>
      {sorted(ledger.packages).map(packageCard)}
      {sorted(ledger.sources).map(s => {
        const Icon = sourceIcon(s);
        const pct = s.total > 0 ? Math.round((s.used / s.total) * 100) : 0;
        const left = lessonsLeftIn(s, ledger.charges);
        const isOpen = !!openSource[s.id];
        // Pagar a venda de um pacote não é "abater aula": conta à parte.
        const paidPackages = s.covers.map(cv => chargeById.get(cv.chargeId)).filter(c => c?.packageSale).map(c => c!.detail);
        const count = s.covers.length - paidPackages.length;
        return (
          <div key={s.id} className="rounded-xl border border-border p-3">
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", s.kind === "package" ? "bg-primary/10 text-primary" : s.kind === "payment" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{s.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-success">+{fmtMoney(s.total)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="capitalize">{day(s.date)}</span>
                  {s.money > 0 && s.voucher > 0 && L(` · ${fmtMoney(s.money)} pagos + ${fmtMoney(s.voucher)} de desconto`, ` · ${fmtMoney(s.money)} paid + ${fmtMoney(s.voucher)} discount`)}
                  {s.money === 0 && L(" · crédito sem dinheiro", " · credit, no money")}
                </div>
                <Progress value={pct} className="mt-2 h-1.5" aria-label={L(`${pct}% usado`, `${pct}% used`)} />
                <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-muted-foreground">
                  <span>
                    {paidPackages.length > 0 ? L(`Pagou: ${paidPackages.join(", ")}${count > 0 ? ` e ${count} ${count === 1 ? ap.l : ap.lp}` : ""}`, `Paid: ${paidPackages.join(", ")}${count > 0 ? ` and ${count} ${count === 1 ? ap.l : ap.lp}` : ""}`)
                      : count === 0 ? L(`Ainda não abateu ${ap.nenhum.toLowerCase()} ${ap.l}`, `Hasn't covered any ${ap.l} yet`)
                      : s.packageSize ? L(`Abateu ${count} de ${s.packageSize} ${ap.lp}`, `Covered ${count} of ${s.packageSize} ${ap.lp}`)
                        : L(`Abateu ${count} ${count === 1 ? ap.l : ap.lp}`, `Covered ${count} ${count === 1 ? ap.l : ap.lp}`)}
                  </span>
                  <span className={s.left > 0 ? "font-medium text-foreground" : ""}>
                    {s.left > 0
                      ? L(`Sobra ${fmtMoney(s.left)}${left ? ` · dá para ${left} ${left === 1 ? ap.l : ap.lp}` : ""}`, `${fmtMoney(s.left)} left${left ? ` · covers ${left} ${left === 1 ? ap.l : ap.lp}` : ""}`)
                      : L("Usado por completo", "Fully used")}
                  </span>
                </div>
                {(s.covers.length > 0 || (actions && s.txIds.length > 0)) && (
                  <button type="button" onClick={() => { haptics.tap(); setOpenSource(o => ({ ...o, [s.id]: !isOpen })); }}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {isOpen ? L("Esconder", "Hide") : s.covers.length > 0 ? L(`Ver onde foi abatido`, `See where it went`) : L("Detalhes", "Details")}
                  </button>
                )}
                {isOpen && (
                  <div className="mt-2 space-y-2">
                    {s.covers.length > 0 && (
                      <ul className="space-y-1 rounded-lg bg-muted/50 p-2 text-xs">
                        {s.covers.map(cv => {
                          const c = chargeById.get(cv.chargeId);
                          if (!c) return null;
                          return (
                            <li key={cv.chargeId} className="flex justify-between gap-2">
                              <span className="min-w-0 truncate"><span className="capitalize">{c.manual ? day(c.date) : dayTime(c.date)}</span> · <span className="text-muted-foreground">{c.detail}</span></span>
                              <span className="shrink-0 tabular-nums">{fmtMoney(cv.amount)}{cv.partial && <span className="text-muted-foreground"> {L("(parte)", "(part)")}</span>}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {actions && s.txIds.length > 0 && (
                      <div className="space-y-1">
                        {s.txIds.map(id => {
                          const t = actions.txInfo?.(id);
                          return (
                            <div key={id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate text-muted-foreground">
                                {t?.kind === "voucher" ? L("Desconto/voucher", "Discount/voucher") : t?.kind === "package" ? L("Pacote", "Package") : L("Pagamento", "Payment")}
                                {t ? ` · ${fmtMoney(t.amount)}` : ""}{t?.description ? ` · ${t.description}` : ""}
                              </span>
                              <span className="flex shrink-0">
                                {actions.onEditTx && <Button size="icon" variant="ghost" className="h-7 w-7" title={L("Editar", "Edit")} onClick={() => actions.onEditTx!(id)}><Pencil className="h-3 w-3" /></Button>}
                                {actions.onDeleteTx && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title={L("Remover", "Remove")} onClick={() => actions.onDeleteTx!(id)}><Trash2 className="h-3 w-3" /></Button>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  // ---- Extrato com saldo ----
  const statementTab = ledger.entries.length === 0 ? (
    <p className="py-3 text-sm text-muted-foreground">{L("Nenhum lançamento ainda.", "No entries yet.")}</p>
  ) : (
    <div className="space-y-2">
      <div className="flex justify-end">{OrderButton}</div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {sorted(ledger.entries).map(e => (
          <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate">{e.label}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                <span className="capitalize">{day(e.date)}</span> · {e.kind === "lesson" ? ap.s : e.kind === "package" ? L("Pacote", "Package") : e.kind === "payment" ? L("Pagamento", "Payment") : e.kind === "voucher" ? L("Desconto", "Discount") : L("Ajuste", "Adjustment")}
              </div>
            </div>
            <div className="shrink-0 text-right">
              {e.kind === "lesson" && e.amount === 0
                ? <div className="text-xs font-medium text-primary">{L("no pacote", "in package")}</div>
                : <div className={cn("font-medium tabular-nums", e.amount > 0 && "text-success")}>{e.amount > 0 ? "+" : ""}{fmtMoney(e.amount)}</div>}
              <div className={cn("text-[11px] tabular-nums", e.balance < 0 ? "text-destructive" : "text-muted-foreground")}>
                {L("saldo", "balance")} {fmtMoney(e.balance)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList className="grid w-full grid-cols-3 rounded-xl">
        <TabsTrigger value="lessons" className="rounded-lg text-xs sm:text-sm">{ap.p} ({lessonCharges.length})</TabsTrigger>
        <TabsTrigger value="payments" className="rounded-lg text-xs sm:text-sm">{L("Pagamentos", "Payments")} ({ledger.sources.length + ledger.packages.length})</TabsTrigger>
        <TabsTrigger value="statement" className="rounded-lg text-xs sm:text-sm">{L("Extrato", "Statement")}</TabsTrigger>
      </TabsList>
      <TabsContent value="lessons" className="mt-3">{lessonsTab}</TabsContent>
      <TabsContent value="payments" className="mt-3">{paymentsTab}</TabsContent>
      <TabsContent value="statement" className="mt-3">{statementTab}</TabsContent>
    </Tabs>
  );
}
