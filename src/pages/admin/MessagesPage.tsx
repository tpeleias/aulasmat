import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useWords } from "@/hooks/useVocabulary";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { WhatsAppGlyph } from "@/components/LessonQuickActions";
import {
  MESSAGE_TYPES, defaultTemplate, fillTemplate, type MessageKey, type MessageTemplates,
} from "@/lib/messageTemplates";
import { lessonVars } from "@/lib/whatsapp";

/**
 * Mensagens prontas da empresa: lembrete, confirmação ao marcar, "estou a
 * caminho" e cobrança. Cada uma é um texto livre com campos entre chaves que o
 * app preenche na hora. Em branco = o texto padrão do app.
 */
export default function MessagesPage() {
  const w = useWords();
  const { templates, loading, save } = useMessageTemplates();
  const [draft, setDraft] = useState<MessageTemplates>({});
  const [busy, setBusy] = useState(false);
  const types = useMemo(() => MESSAGE_TYPES(w), [w]);

  useEffect(() => { document.title = "Mensagens — Cronys"; }, []);

  // O rascunho começa com o texto em uso (o da empresa ou o padrão).
  useEffect(() => {
    if (loading) return;
    setDraft(Object.fromEntries(types.map(t => [t.key, templates[t.key]?.trim() || defaultTemplate(t.key, w)])) as MessageTemplates);
  }, [loading, templates, types, w]);

  // Exemplo para a prévia: uma aula de amanhã às 15h, em casa.
  const sample = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(15, 0, 0, 0);
    const lesson = { student_name: "Lucas Almeida", guardian_name: "Carla Almeida", start_at: d, address: "Rua das Acácias, 120" };
    const base = lessonVars(lesson, w);
    const map = "https://maps.google.com/?q=-23.56100,-46.65600";
    return {
      ...base,
      mapa: map,
      localizacao: ` Minha localização agora: ${map}`,
      lista: `📅 *Segunda, 28/09* às 15:00\n${w.topic.s} · 60 min\n💰 R$ 150,00`,
      resumo: "━━━━━━━━━━━━━━\n*Total a pagar: R$ 150,00*\n━━━━━━━━━━━━━━",
      total: "R$ 150,00",
      como_pagar: "\n\n*Como pagar* (do jeito mais fácil pra você):\n\n💠 *Pix*\nChave: sua-chave-pix",
      de_aluno: " de Lucas",
    } as Record<string, string>;
  }, [w]);

  const persist = async (next: MessageTemplates, ok: string) => {
    setBusy(true);
    // O que for igual ao padrão não é guardado: assim a mensagem acompanha o
    // app se o texto padrão melhorar.
    const onlyCustom = Object.fromEntries(
      Object.entries(next).filter(([k, v]) => v && v.trim() && v.trim() !== defaultTemplate(k as MessageKey, w).trim()),
    ) as MessageTemplates;
    const error = await save(onlyCustom);
    setBusy(false);
    if (error) toast.error("Não foi possível salvar as mensagens agora.");
    else toast.success(ok);
  };

  if (loading) return <Skeleton className="h-64 w-full rounded-2xl" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><MessageSquareText className="h-6 w-6 text-primary" /> Mensagens</h1>
        <p className="text-sm text-muted-foreground">
          Os textos que o app monta para o WhatsApp. Escreva do seu jeito; os campos entre chaves, como <code>{"{nome}"}</code> e <code>{"{hora}"}</code>,
          são preenchidos na hora com os dados {w.appointment.do} {w.appointment.l}.
        </p>
      </div>

      {types.map(t => (
        <TemplateCard
          key={t.key}
          title={t.title}
          when={t.when}
          tags={t.tags}
          value={draft[t.key] ?? ""}
          preview={fillTemplate(draft[t.key]?.trim() || defaultTemplate(t.key, w), sample)}
          custom={!!templates[t.key]?.trim()}
          busy={busy}
          onChange={v => setDraft(d => ({ ...d, [t.key]: v }))}
          onReset={() => {
            const next = { ...draft, [t.key]: defaultTemplate(t.key, w) };
            setDraft(next);
            persist(next, "Mensagem padrão restaurada");
          }}
        />
      ))}

      <div className="sticky bottom-20 z-10 flex justify-end md:bottom-4">
        <Button className="rounded-xl shadow-lg" disabled={busy} onClick={() => persist(draft, "Mensagens salvas")}>Salvar mensagens</Button>
      </div>
    </div>
  );
}

function TemplateCard({ title, when, tags, value, preview, custom, busy, onChange, onReset }: {
  title: string; when: string; tags: { tag: string; desc: string }[]; value: string; preview: string;
  custom: boolean; busy: boolean; onChange: (v: string) => void; onReset: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Toca no campo e ele entra onde o cursor está.
  const insert = (tag: string) => {
    const el = ref.current;
    const text = `{${tag}}`;
    if (!el) { onChange(value + text); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length); });
  };

  return (
    <Card className="space-y-3 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{when}{custom ? " · personalizada" : " · padrão do app"}</p>
        </div>
        {custom && (
          <Button size="sm" variant="ghost" className="shrink-0 gap-1 text-xs" disabled={busy} onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" /> Padrão
          </Button>
        )}
      </div>
      <Textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} rows={value.split("\n").length > 4 ? 10 : 4} className="font-mono text-sm" />
      <div className="flex flex-wrap gap-1.5">
        {tags.map(t => (
          <button key={t.tag} type="button" title={t.desc} onClick={() => insert(t.tag)}
            className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted">
            {`{${t.tag}}`}
          </button>
        ))}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">O que cada campo vira</summary>
        <ul className="mt-2 space-y-1">
          {tags.map(t => <li key={t.tag}><code>{`{${t.tag}}`}</code>: {t.desc}</li>)}
        </ul>
      </details>
      <div className="rounded-xl bg-[#e7ffdb] p-3 text-sm text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]">
        <div className="mb-1 flex items-center gap-1 text-[11px] opacity-70"><WhatsAppGlyph className="h-3 w-3" /> Prévia</div>
        <p className="whitespace-pre-wrap break-words">{preview}</p>
      </div>
    </Card>
  );
}
