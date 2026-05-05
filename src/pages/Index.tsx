import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GraduationCap, Calendar, Wallet, Link2 } from "lucide-react";

export default function Index() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--gradient-subtle)" }}>
      <header className="px-4 py-5 border-b border-border bg-card">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold">Agenda do Professor</span>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="ghost"><Link to="/disponibilidade">Ver disponibilidade</Link></Button>
            <Button asChild><Link to="/auth">Entrar</Link></Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-4 py-16 w-full">
        <section className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Sua agenda de aulas, organizada.</h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">Sistema interno para gerir horários, bloqueios e cobranças do professor particular de matemática.</p>
          <div className="flex gap-3 justify-center mt-8">
            <Button size="lg" asChild><Link to="/auth">Acessar painel</Link></Button>
            <Button size="lg" variant="outline" asChild><Link to="/disponibilidade">Página pública</Link></Button>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-6">
          {[
            { i: Calendar, t: "Calendário interativo", d: "Agende aulas e bloqueie horários da escola e lazer." },
            { i: Wallet, t: "Gestão de cobranças", d: "Pacotes de 5 e 10 aulas, status de pagamento e painel de pendências." },
            { i: Link2, t: "Link público read-only", d: "Compartilhe seus 5 próximos dias livres sem permitir agendamento." },
          ].map(({ i: Ic, t, d }) => (
            <div key={t} className="bg-card p-6 rounded-xl shadow-[var(--shadow-card)] border border-border">
              <Ic className="w-6 h-6 text-primary mb-3" />
              <h3 className="font-semibold mb-1">{t}</h3>
              <p className="text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
