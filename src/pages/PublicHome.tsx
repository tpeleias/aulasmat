import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { AvailabilityBoard } from "@/components/AvailabilityBoard";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  GraduationCap, Clock, MapPin, Monitor, MessageCircle, Info, CalendarCheck, LogIn, BookOpen, ListChecks, FolderOpen,
} from "lucide-react";

type Settings = {
  work_start: string;
  work_end: string;
  slot_minutes: number;
};

const hhmm = (t?: string) => (t ? t.slice(0, 5) : "");

export default function PublicHome() {
  const { teachers, loading } = useTeachers(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    document.title = "Aulas particulares de Matemática e Química | Horários livres";
    const desc = "Veja os horários disponíveis dos professores nos próximos 5 dias e fale direto pelo WhatsApp. Aulas presenciais ou online.";
    const m = document.querySelector('meta[name="description"]') ||
      (() => { const el = document.createElement("meta"); el.setAttribute("name", "description"); document.head.appendChild(el); return el; })();
    m.setAttribute("content", desc);

    supabase
      .from("settings")
      .select("work_start, work_end, slot_minutes")
      
      .maybeSingle()
      .then(({ data }) => setSettings((data as any) ?? null));
  }, []);

  useEffect(() => {
    if (!active && teachers.length) setActive(teacherSlug(teachers[0].name));
  }, [teachers, active]);

  const whatsFor = (slug: string) => {
    const t = teachers.find(x => teacherSlug(x.name) === slug);
    return t && t.whatsapp_enabled !== false ? t.whatsapp : null;
  };

  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--gradient-subtle)" }}>
      <header className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
              <GraduationCap className="text-primary-foreground w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold leading-tight">Aulas Particulares</div>
              <div className="text-xs text-muted-foreground">Matemática e Química</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block w-36"><ThemeToggle /></div>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/"><LogIn className="w-4 h-4" />Entrar</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-10 space-y-12">
        <section className="text-center space-y-4">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Reforço de Matemática e Química com horário na hora certa
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Consulte abaixo os horários realmente livres dos professores nos próximos 5 dias e reserve o seu
            falando direto pelo WhatsApp — sem cadastro e sem compromisso.
          </p>
        </section>

        <section className="grid sm:grid-cols-3 gap-4">
          {[
            { i: Clock, t: "Aulas de 1 hora", d: settings ? `Atendimento das ${hhmm(settings.work_start)} às ${hhmm(settings.work_end)}` : "Horários flexíveis ao longo do dia" },
            { i: MapPin, t: "Presencial ou online", d: "Aula na sua casa ou por vídeo, você escolhe" },
            { i: CalendarCheck, t: "Avulsa ou em pacote", d: "Pacotes de 5 ou 10 aulas com valor por hora reduzido" },
          ].map(({ i: Ic, t, d }) => (
            <Card key={t} className="p-5">
              <Ic className="w-5 h-5 text-primary mb-2" />
              <div className="font-semibold text-sm">{t}</div>
              <p className="text-sm text-muted-foreground mt-1">{d}</p>
            </Card>
          ))}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-bold">Disponibilidade dos professores</h2>
            <p className="text-sm text-muted-foreground">Próximos 5 dias, atualizado automaticamente.</p>
          </div>

          <Card className="p-4 flex gap-3 bg-accent border-accent">
            <Info className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-accent-foreground">
              <strong>Esta página é informativa.</strong> O agendamento é confirmado pelo professor após o contato.
            </p>
          </Card>

          {loading && <p className="text-muted-foreground text-sm">Carregando professores…</p>}

          {!loading && teachers.length > 0 && active && (
            <Tabs value={active} onValueChange={setActive}>
              <TabsList className="flex-wrap h-auto">
                {teachers.map(t => (
                  <TabsTrigger key={t.id} value={teacherSlug(t.name)}>{t.name}</TabsTrigger>
                ))}
              </TabsList>
              {teachers.map(t => {
                const slug = teacherSlug(t.name);
                const wa = whatsFor(slug);
                return (
                  <TabsContent key={t.id} value={slug} className="space-y-4 pt-4">
                    {wa && (
                      <Button asChild className="gap-2">
                        <a
                          href={`https://wa.me/${String(wa).replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${t.name}! Vi os horários no site e gostaria de agendar uma aula.`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MessageCircle className="w-4 h-4" /> Falar com {t.name} no WhatsApp
                        </a>
                      </Button>
                    )}
                    <AvailabilityBoard teacher={slug} />
                  </TabsContent>
                );
              })}
            </Tabs>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold">O que o aluno recebe</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { i: BookOpen, t: "Aulas sob medida", d: "Conteúdo alinhado à escola, provas e vestibulares." },
              { i: FolderOpen, t: "Materiais no portal", d: "Listas e resumos ficam disponíveis na área do aluno." },
              { i: ListChecks, t: "Tarefas acompanhadas", d: "Exercícios com prazo e correção do professor." },
            ].map(({ i: Ic, t, d }) => (
              <Card key={t} className="p-5">
                <Ic className="w-5 h-5 text-primary mb-2" />
                <div className="font-semibold text-sm">{t}</div>
                <p className="text-sm text-muted-foreground mt-1">{d}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Perguntas frequentes</h2>
          {[
            { q: "Preciso criar conta para ver os horários?", a: "Não. Esta página é aberta a qualquer visitante. A conta só é criada depois que as aulas começam, para acompanhar aulas, materiais e cobranças." },
            { q: "Os horários mostrados já estão garantidos?", a: "Eles refletem a agenda real do professor, mas a reserva só é confirmada no contato por WhatsApp." },
            { q: "As aulas podem ser online?", a: "Sim. As aulas podem ser presenciais ou por vídeo, combinando no momento do agendamento." },
            { q: "Como funciona a cobrança?", a: "O valor é por hora de aula e pode ser avulso ou em pacotes de 5 e 10 aulas, com pagamento por PIX ou link de pagamento." },
          ].map(({ q, a }) => (
            <Card key={q} className="p-4">
              <div className="font-semibold text-sm mb-1">{q}</div>
              <p className="text-sm text-muted-foreground">{a}</p>
            </Card>
          ))}
        </section>

        <section className="text-center space-y-3">
          <Monitor className="w-6 h-6 text-primary mx-auto" />
          <h2 className="text-xl font-bold">Já é aluno ou responsável?</h2>
          <p className="text-sm text-muted-foreground">Acesse o portal para ver aulas, materiais, tarefas e financeiro.</p>
          <Button asChild><Link to="/">Entrar no portal</Link></Button>
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center text-xs text-muted-foreground">
          Página pública e informativa — não há agendamento online automático.
        </div>
      </footer>
    </div>
  );
}
