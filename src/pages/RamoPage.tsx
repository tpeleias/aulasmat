import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Globe } from "lucide-react";
import { CronysWordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isEnglish, toggleLanguage, L } from "@/lib/i18n";
import { TRIAL_DAYS } from "@/lib/subscription";
import { ramoPage, ramoPages } from "@/lib/ramoPages";
import NotFound from "@/pages/NotFound";

/**
 * Página de um ramo (`/para/psicologos`, `/para/saloes`...). Mesmo visual da
 * página inicial; o texto fala a língua de quem chega por ali.
 */
export default function RamoPage() {
  const { ramo } = useParams<{ ramo: string }>();
  const page = ramoPage(ramo);

  useEffect(() => {
    if (!page) return;
    document.title = `${page.titulo} — Cronys`;
    const m = document.querySelector('meta[name="description"]') || (() => {
      const el = document.createElement("meta"); el.setAttribute("name", "description"); document.head.appendChild(el); return el;
    })();
    m.setAttribute("content", page.resumo);
  }, [page]);

  if (!page) return <NotFound />;
  const outros = ramoPages().filter(r => r.slug !== page.slug);

  return (
    <div className="flex-1 bg-background">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <Link to="/"><CronysWordmark tamanho="1.5rem" className="text-brand-ink" /></Link>
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
          <p className="relative mb-3 text-sm font-medium uppercase tracking-wide text-brand-gold">{L("Para", "For")} {page.quem}</p>
          <h1 className="relative max-w-2xl text-3xl font-bold leading-tight tracking-tight md:text-5xl">{page.titulo}</h1>
          <p className="relative mt-4 max-w-xl text-sidebar-foreground/75 md:text-lg">{page.resumo}</p>
          <div className="relative mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-xl"><Link to="/entrar?criar=empresa">{L(`Começar - ${TRIAL_DAYS} dias do Pro grátis`, `Get started - ${TRIAL_DAYS} days of Pro free`)}</Link></Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl border-white/30 bg-transparent text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground">
              <Link to="/#planos">{L("Ver planos", "See plans")}</Link>
            </Button>
          </div>
          <p className="relative mt-3 text-xs text-sidebar-foreground/60">{L("Sem cartão para testar. Depois do teste, continua de graça no Essencial.", "No card needed to try. After the trial, it stays free on Essential.")}</p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-14">
          <h2 className="text-2xl font-bold">{L("O que ajuda no seu dia", "What helps your day")}</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {page.dores.map(d => (
              <Card key={d.titulo} className="p-5">
                <h3 className="font-semibold">{d.titulo}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{d.texto}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="pb-14">
          <h2 className="text-2xl font-bold">{L("Um dia com o Cronys", "A day with Cronys")}</h2>
          <ul className="mt-6 space-y-3 text-sm">
            {page.dia.map(x => <li key={x} className="rounded-lg border border-border bg-card p-4">{x}</li>)}
          </ul>
        </section>

        <section className="pb-14">
          <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">{L("Teste no seu ritmo", "Try it at your own pace")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{L(`${TRIAL_DAYS} dias do Pro, sem cartão. Depois, o Essencial é gratuito.`, `${TRIAL_DAYS} days of Pro, no card. After that, Essential is free.`)}</p>
            </div>
            <Button asChild size="lg" className="rounded-xl"><Link to="/entrar?criar=empresa">{L("Criar minha conta", "Create my account")}</Link></Button>
          </Card>
        </section>

        <section className="pb-14">
          <h2 className="text-lg font-semibold">{L("Outros ramos", "Other industries")}</h2>
          <nav className="mt-3 flex flex-wrap gap-2">
            {outros.map(r => (
              <Link key={r.slug} to={`/para/${r.slug}`} className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-accent">{r.quem}</Link>
            ))}
          </nav>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Cronys</span>
          <nav className="flex flex-wrap gap-4">
            <Link to="/termos" className="hover:underline">{L("Termos de uso", "Terms of use")}</Link>
            <Link to="/privacidade" className="hover:underline">{L("Privacidade", "Privacy")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
