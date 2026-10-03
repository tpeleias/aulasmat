import { useRef, useState } from "react";
import { ImagePlus, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTasksEnabled, useWords } from "@/hooks/useVocabulary";
import { cap } from "@/lib/vocabulary";
import { L } from "@/lib/i18n";

/**
 * A cara da empresa nos e-mails (03/10, etapa 3). Grava nas mesmas escolhas
 * dos e-mails (settings.email_notifications, migration 20261003080000):
 *   Pro e Max: brand_logo, brand_color, brand_signature
 *   Max: templates {tipo: {subject, message}}, reminder_eve_hour, reminder_day_hour
 * A função "emails" confere o plano antes de usar; aqui é só a tela.
 */
type Prefs = Record<string, unknown>;
type Templates = Record<string, { subject?: string; message?: string }>;

const MAX_LOGO = 512 * 1024;

export function EmailBrandingSettings({ value, set, accountId, canBrand, canCustom }: {
  value: Prefs; set: (k: string, v: unknown) => void; accountId: string | null;
  canBrand: boolean; canCustom: boolean;
}) {
  const w = useWords();
  const tasks = useTasksEnabled();
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState("eve");
  const logo = typeof value.brand_logo === "string" ? value.brand_logo : "";
  const color = typeof value.brand_color === "string" && /^#[0-9a-f]{6}$/i.test(value.brand_color) ? value.brand_color : "";
  const signature = typeof value.brand_signature === "string" ? value.brand_signature : "";
  const templates = (value.templates && typeof value.templates === "object" ? value.templates : {}) as Templates;
  const current = templates[kind] ?? {};
  const eveHour = Number(value.reminder_eve_hour) || 18;
  const dayHour = Number(value.reminder_day_hour) || 7;

  const KINDS: { k: string; label: string; fields: string }[] = [
    { k: "booked", label: L(`${cap(w.appointment.s)} ${w.appointment.pick("marcado", "marcada")}`, `${w.appointment.s} booked`), fields: "{nome} {responsavel} {data} {hora} {profissional}" },
    { k: "changed", label: L("Horário alterado", "Time changed"), fields: "{nome} {responsavel} {data} {hora} {profissional}" },
    { k: "cancelled", label: L(`${cap(w.appointment.s)} ${w.appointment.pick("cancelado", "cancelada")}`, `${w.appointment.s} canceled`), fields: "{nome} {responsavel} {data} {hora} {profissional}" },
    { k: "eve", label: L("Lembrete da véspera", "Day-before reminder"), fields: "{nome} {responsavel} {data} {hora} {profissional}" },
    { k: "day", label: L("Lembrete do dia", "Same-day reminder"), fields: "{nome} {responsavel} {data} {hora} {profissional}" },
    { k: "charge", label: L("Cobrança", "Payment reminder"), fields: "{nome} {responsavel} {valor}" },
    { k: "payment", label: L("Pagamento recebido", "Payment received"), fields: "{nome} {valor} {data}" },
    ...(tasks ? [{ k: "homework", label: L(`${w.task.novo} ${w.task.l}`, `New ${w.task.l}`), fields: "{nome} {tarefa} {prazo}" }] : []),
    { k: "class_summary", label: L(`Resumo ${w.appointment.pick("do", "da")} ${w.appointment.l}`, `${w.appointment.s} summary`), fields: "{nome} {data} {profissional}" },
    { k: "package", label: L("Pacote acabando", "Package running out"), fields: "{nome} {responsavel} {saldo}" },
  ];
  const info = KINDS.find(x => x.k === kind)!;

  const setTemplate = (field: "subject" | "message", v: string) => {
    const next: Templates = { ...templates, [kind]: { ...current, [field]: v } };
    if (!next[kind].subject?.trim() && !next[kind].message?.trim()) delete next[kind];
    set("templates", next);
  };

  const upload = async (f: File | undefined) => {
    if (!f || !accountId) return;
    if (!["image/png", "image/jpeg"].includes(f.type)) { toast.error(L("Use uma imagem PNG ou JPG.", "Use a PNG or JPG image.")); return; }
    if (f.size > MAX_LOGO) { toast.error(L("A imagem passa de 500 KB. Use uma menor.", "The image is over 500 KB. Use a smaller one.")); return; }
    setUploading(true);
    const path = `${accountId}/logo-${Date.now()}.${f.type === "image/png" ? "png" : "jpg"}`;
    const { error } = await supabase.storage.from("email-logos").upload(path, f, { contentType: f.type });
    setUploading(false);
    if (error) { toast.error(L("Não deu para enviar o logo. Tente de novo.", "Couldn't upload the logo. Try again.")); return; }
    set("brand_logo", supabase.storage.from("email-logos").getPublicUrl(path).data.publicUrl);
    toast.success(L("Logo enviado. Salve as configurações para valer.", "Logo uploaded. Save the settings to apply it."));
  };

  const lock = (text: string) => <span className="inline-flex items-center gap-1 font-normal"><Lock className="h-3 w-3" /> {text}</span>;

  return (
    <div className="space-y-4">
      <div className={`space-y-3 ${canBrand ? "" : "opacity-60"}`}>
        <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          {L("A cara da empresa", "Your brand")} {!canBrand && lock(L("nos planos Pro e Max", "on the Pro and Max plans"))}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {logo
            ? <img src={logo} alt={L("Logo", "Logo")} className="h-10 max-w-[160px] rounded border bg-white object-contain p-1" />
            : <span className="text-sm text-muted-foreground">{L("Sem logo: vai o nome da empresa.", "No logo: your business name shows instead.")}</span>}
          <input ref={file} type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          <Button type="button" variant="outline" size="sm" className="gap-2 rounded-xl" disabled={!canBrand || uploading || !accountId} onClick={() => file.current?.click()}>
            <ImagePlus className="h-3.5 w-3.5" /> {logo ? L("Trocar o logo", "Change logo") : L("Enviar o logo", "Upload logo")}
          </Button>
          {logo && <Button type="button" variant="ghost" size="sm" className="gap-1 rounded-xl" disabled={!canBrand} onClick={() => set("brand_logo", "")}>
            <Trash2 className="h-3.5 w-3.5" /> {L("Tirar", "Remove")}
          </Button>}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {L("Cor dos botões e da faixa", "Button and stripe color")}
          <input type="color" aria-label={L("Cor", "Color")} disabled={!canBrand} value={color || "#c9a24b"} onChange={e => set("brand_color", e.target.value)}
            className="h-8 w-12 cursor-pointer rounded border bg-transparent p-0.5" />
          {color && <Button type="button" variant="ghost" size="sm" className="h-8 rounded-xl" disabled={!canBrand} onClick={() => set("brand_color", "")}>{L("Cor padrão", "Default color")}</Button>}
        </label>
        <div className="space-y-1">
          <label htmlFor="brand-signature" className="text-sm">{L("Assinatura no fim de cada e-mail", "Signature at the end of every email")}</label>
          <Textarea id="brand-signature" rows={2} maxLength={300} disabled={!canBrand} value={signature} onChange={e => set("brand_signature", e.target.value)}
            placeholder={L("Ex.: Um abraço, Thiago · (11) 99999-0000", "E.g.: Best, Thiago · (555) 123-4567")} />
        </div>
      </div>

      <div className={`space-y-3 ${canCustom ? "" : "opacity-60"}`}>
        <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          {L("Seus textos e horários", "Your texts and times")} {!canCustom && lock(L("no plano Max", "on the Max plan"))}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{L("Lembrete da véspera às", "Day-before reminder at")}</span>
          <Select disabled={!canCustom} value={String(eveHour)} onValueChange={v => set("reminder_eve_hour", Number(v))}>
            <SelectTrigger className="h-8 w-20 rounded-lg" aria-label={L("Hora do lembrete da véspera", "Day-before reminder hour")}><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 11 }, (_, i) => i + 12).map(h => <SelectItem key={h} value={String(h)}>{h}h</SelectItem>)}</SelectContent>
          </Select>
          <span>{L("e o do dia às", "and same-day at")}</span>
          <Select disabled={!canCustom} value={String(dayHour)} onValueChange={v => set("reminder_day_hour", Number(v))}>
            <SelectTrigger className="h-8 w-20 rounded-lg" aria-label={L("Hora do lembrete do dia", "Same-day reminder hour")}><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 7 }, (_, i) => i + 5).map(h => <SelectItem key={h} value={String(h)}>{h}h</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{L("Texto do e-mail de", "Text for")}</span>
            <Select disabled={!canCustom} value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-8 w-56 rounded-lg" aria-label={L("Qual e-mail", "Which email")}><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map(x => <SelectItem key={x.k} value={x.k}>{x.label}{templates[x.k] ? " ✓" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input disabled={!canCustom} maxLength={150} value={current.subject ?? ""} onChange={e => setTemplate("subject", e.target.value)}
            aria-label={L("Assunto", "Subject")} placeholder={L("Assunto (vazio = o padrão)", "Subject (empty = default)")} />
          <Textarea disabled={!canCustom} rows={3} maxLength={1500} value={current.message ?? ""} onChange={e => setTemplate("message", e.target.value)}
            aria-label={L("Mensagem", "Message")} placeholder={L("Mensagem de abertura (vazio = a padrão). Os dados (data, valor, Pix...) continuam aparecendo embaixo.", "Opening message (empty = default). The details (date, amount...) still show below.")} />
          <p className="text-xs text-muted-foreground">{L("Campos:", "Fields:")} <code>{info.fields} {"{empresa}"}</code></p>
          {templates[kind] && <Button type="button" variant="ghost" size="sm" className="h-8 rounded-xl" disabled={!canCustom}
            onClick={() => { const next = { ...templates }; delete next[kind]; set("templates", next); }}>{L("Voltar ao texto padrão", "Back to the default text")}</Button>}
        </div>
      </div>
    </div>
  );
}
