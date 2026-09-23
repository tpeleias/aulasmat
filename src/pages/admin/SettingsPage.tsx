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

// Um par de números por dia da semana, 0 = domingo.
type ScarcityDay = { min: number; max: number };
type Scarcity = Record<string, ScarcityDay>;

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
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
};

export default function SettingsPage() {
  const { plan, loading: planLoading } = usePlan();
  const [s, setS] = useState<Settings>({
    work_start: "08:00", work_end: "22:00", slot_minutes: 60,
    default_lesson_price: FALLBACK_LESSON_PRICE,
    scarcity: SCARCITY_PADRAO,
    pix_key: "", payment_link: "", contact_email: "", issuer_document: "",
    show_payment_info_to_students: false,
    allow_student_booking: true,
    show_availability_to_students: false,
  });
  // O banco entrega só a linha da própria empresa, então a consulta não filtra
  // por id - mas o id da linha carregada é guardado para gravar exatamente nela.
  const [rowId, setRowId] = useState<number | null>(null);
  useEffect(() => {
    supabase.from("settings").select("*").maybeSingle().then(({ data }) => {
      if (!data) return;
      setRowId((data as any).id);
      const vindo = (data as any).scarcity as Scarcity | null;
      setS({ ...s, ...(data as any), scarcity: vindo ?? SCARCITY_PADRAO });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v || lo));

  const save = async () => {
    if (rowId === null) { toast.error("Configurações ainda carregando"); return; }
    // O banco recusa valor zerado ou negativo; avisar aqui evita a mensagem
    // crua do Postgres, e a checagem de lá continua sendo a que vale.
    if (!(Number(s.default_lesson_price) > 0)) {
      toast.error("O valor da aula precisa ser maior que zero");
      return;
    }
    const { id: _id, account_id: _account, ...rest } = s as any;
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
      issuer_document: (s.issuer_document || "").trim() || null,
    };
    const { error } = await supabase.from("settings").update(payload).eq("id", rowId);
    if (error) toast.error(error.message);
    else {
      setS({ ...s, ...payload } as any);
      // As outras telas leem o valor de um cache; sem isto, o diálogo de nova
      // aula continuaria abrindo com o preço antigo até recarregar a página.
      primeLessonPrice(payload.default_lesson_price);
      toast.success("Configurações salvas");
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Janela de trabalho, pagamento e contato.</p>
      </div>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-sm uppercase text-muted-foreground">Janela de trabalho</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Início do dia</Label><Input type="time" value={s.work_start.slice(0,5)} onChange={e => setS({ ...s, work_start: e.target.value })} /></div>
          <div><Label>Fim do dia</Label><Input type="time" value={s.work_end.slice(0,5)} onChange={e => setS({ ...s, work_end: e.target.value })} /></div>
        </div>
        <div><Label>Duração do slot (min)</Label><Input type="number" value={s.slot_minutes} onChange={e => setS({ ...s, slot_minutes: Number(e.target.value) })} /></div>
      </Card>

      {!planLoading && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-sm uppercase text-muted-foreground">Seu plano</h2>
            <Badge variant={plan.plano === "pro" ? "default" : "outline"}>{plan.nome}</Badge>
          </div>
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">Professores</span>
              <strong>{plan.max_teachers ?? "sem limite"}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">Alunos</span>
              <strong>{plan.max_students ?? "sem limite"}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">Pacotes, vouchers e desconto</span>
              <strong>{plan.packages ? "sim" : "não"}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">Bloqueio que se repete toda semana</span>
              <strong>{plan.recurring_blocks ? "sim" : "não"}</strong>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">Assistente</span>
              <strong>
                {plan.assistant ? "sim"
                  : plan.assistant_override === false ? "desativado pela Cronys"
                    : "não"}
              </strong>
            </li>
          </ul>
          {plan.plano !== "pro" && (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              O que você já cadastrou continua aqui, sempre. Os limites valem só
              para cadastrar coisa nova. Para mudar de plano, fale com quem cuida
              da sua conta.
            </p>
          )}
        </Card>
      )}

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">Valor da aula</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Quanto custa uma hora de aula. É com este valor que toda aula nova
            nasce — na agenda, no portal da família e no assistente.
          </p>
        </div>
        <div>
          <Label>Valor por hora (R$/h)</Label>
          <Input
            type="number"
            min={1}
            step="0.01"
            inputMode="decimal"
            value={s.default_lesson_price}
            onChange={e => setS({ ...s, default_lesson_price: Number(e.target.value) })}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Uma aula de 1 hora sai por{" "}
            <strong className="text-foreground">{fmtMoney(Number(s.default_lesson_price) || 0)}</strong>;
            uma de 90 min, por{" "}
            <strong className="text-foreground">{fmtMoney((Number(s.default_lesson_price) || 0) * 1.5)}</strong>.
          </p>
        </div>
        <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          Mudar aqui vale para as <strong className="text-foreground">próximas</strong> aulas.
          As que já estão na agenda ficam com o valor que tinham — para mudar uma
          delas, abra a aula e edite o valor. Para cobrar menos de uma família
          sem mexer no valor da aula, use <strong className="text-foreground">Desconto</strong> na
          tela de Cobrança.
        </p>
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-sm uppercase text-muted-foreground">Pagamento</h2>
        <div><Label>Chave PIX</Label><Input value={s.pix_key ?? ""} onChange={e => setS({ ...s, pix_key: e.target.value })} placeholder="CPF, e-mail, telefone ou chave aleatória" /></div>
        <div><Label>Link de pagamento (InfinitePay, Mercado Pago, etc.)</Label><Input value={s.payment_link ?? ""} onChange={e => setS({ ...s, payment_link: e.target.value })} placeholder="https://..." /></div>
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label className="cursor-pointer">Exibir dados de pagamento ao aluno</Label>
            <p className="text-xs text-muted-foreground">Mostra PIX e link de pagamento no portal do aluno.</p>
          </div>
          <Switch checked={s.show_payment_info_to_students} onCheckedChange={v => setS({ ...s, show_payment_info_to_students: v })} />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">Contato</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Aparece na página pública de privacidade, que a Play Store exige. Em branco,
            a página pede para a família falar com o professor, em vez de mostrar um
            e-mail que não é seu.
          </p>
        </div>
        <div>
          <Label>E-mail de contato</Label>
          <Input
            type="email"
            value={s.contact_email ?? ""}
            onChange={e => setS({ ...s, contact_email: e.target.value })}
            placeholder="seu@email.com"
          />
        </div>
        <div>
          <Label>CPF ou CNPJ</Label>
          <Input
            value={s.issuer_document ?? ""}
            onChange={e => setS({ ...s, issuer_document: e.target.value })}
            placeholder="000.000.000-00"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Impresso nos recibos, em Relatórios. Em branco, o recibo sai com a linha vazia para preencher à mão.
          </p>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold text-sm uppercase text-muted-foreground">Portal do Aluno</h2>
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label className="cursor-pointer">Permitir que alunos agendem aulas diretamente</Label>
            <p className="text-xs text-muted-foreground">Quando desligado, o portal do aluno fica apenas para visualização.</p>
          </div>
          <Switch checked={s.allow_student_booking} onCheckedChange={v => setS({ ...s, allow_student_booking: v })} />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label className="cursor-pointer">Exibir disponibilidade dos professores ao responsável</Label>
            <p className="text-xs text-muted-foreground">Mostra os links de agenda dos professores no portal do aluno.</p>
          </div>
          <Switch checked={s.show_availability_to_students} onCheckedChange={v => setS({ ...s, show_availability_to_students: v })} />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">Escassez na página pública</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Quantos horários livres aparecem por dia. O app sorteia um número entre
            o mínimo e o máximo, então a página não mostra a agenda inteira.
          </p>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 items-center">
            <span />
            <Label className="text-xs text-muted-foreground text-center">Mínimo</Label>
            <Label className="text-xs text-muted-foreground text-center">Máximo</Label>
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

      <Button onClick={save}>Salvar</Button>
    </div>
  );
}
