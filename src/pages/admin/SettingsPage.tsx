import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

type Settings = {
  work_start: string; work_end: string; slot_minutes: number;
  scarcity_weekday_min: number; scarcity_weekday_max: number;
  scarcity_weekend_min: number; scarcity_weekend_max: number;
  pix_key: string | null; payment_link: string | null;
  show_payment_info_to_students: boolean;
  whatsapp_thiago: string | null; whatsapp_mayara: string | null;
  allow_student_booking: boolean;
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings>({
    work_start: "08:00", work_end: "22:00", slot_minutes: 60,
    scarcity_weekday_min: 1, scarcity_weekday_max: 3,
    scarcity_weekend_min: 3, scarcity_weekend_max: 7,
    pix_key: "", payment_link: "", show_payment_info_to_students: false,
    whatsapp_thiago: "", whatsapp_mayara: "",
    allow_student_booking: true,
  });
  useEffect(() => {
    supabase.from("settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => data && setS({ ...s, ...(data as any) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v || lo));

  const save = async () => {
    const payload = {
      ...s,
      scarcity_weekday_min: clamp(s.scarcity_weekday_min, 1, 4),
      scarcity_weekday_max: clamp(Math.max(s.scarcity_weekday_max, s.scarcity_weekday_min), 1, 4),
      scarcity_weekend_min: clamp(s.scarcity_weekend_min, 1, 7),
      scarcity_weekend_max: clamp(Math.max(s.scarcity_weekend_max, s.scarcity_weekend_min), 1, 7),
      pix_key: (s.pix_key || "").trim() || null,
      payment_link: (s.payment_link || "").trim() || null,
      whatsapp_thiago: (s.whatsapp_thiago || "").trim() || null,
      whatsapp_mayara: (s.whatsapp_mayara || "").trim() || null,
    };
    const { error } = await supabase.from("settings").update(payload).eq("id", 1);
    if (error) toast.error(error.message); else { setS(payload as any); toast.success("Configurações salvas"); }
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
        <h2 className="font-semibold text-sm uppercase text-muted-foreground">Contato (WhatsApp)</h2>
        <p className="text-xs text-muted-foreground -mt-2">Use formato internacional sem espaços. Ex: 5511999999999</p>
        <div><Label>WhatsApp do Thiago</Label><Input value={s.whatsapp_thiago ?? ""} onChange={e => setS({ ...s, whatsapp_thiago: e.target.value })} placeholder="5511..." /></div>
        <div><Label>WhatsApp da Mayara</Label><Input value={s.whatsapp_mayara ?? ""} onChange={e => setS({ ...s, whatsapp_mayara: e.target.value })} placeholder="5511..." /></div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">Escassez na página pública</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Define quantos horários no máximo aparecem por dia.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Dias de semana (Seg–Sex)</Label>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs text-muted-foreground">Mínimo (1–4)</Label>
              <Input type="number" min={1} max={4} value={s.scarcity_weekday_min} onChange={e => setS({ ...s, scarcity_weekday_min: Number(e.target.value) })} /></div>
            <div><Label className="text-xs text-muted-foreground">Máximo (1–4)</Label>
              <Input type="number" min={1} max={4} value={s.scarcity_weekday_max} onChange={e => setS({ ...s, scarcity_weekday_max: Number(e.target.value) })} /></div>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Finais de semana (Sáb–Dom)</Label>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs text-muted-foreground">Mínimo (1–7)</Label>
              <Input type="number" min={1} max={7} value={s.scarcity_weekend_min} onChange={e => setS({ ...s, scarcity_weekend_min: Number(e.target.value) })} /></div>
            <div><Label className="text-xs text-muted-foreground">Máximo (1–7)</Label>
              <Input type="number" min={1} max={7} value={s.scarcity_weekend_max} onChange={e => setS({ ...s, scarcity_weekend_max: Number(e.target.value) })} /></div>
          </div>
        </div>
      </Card>

      <Button onClick={save}>Salvar</Button>
    </div>
  );
}
