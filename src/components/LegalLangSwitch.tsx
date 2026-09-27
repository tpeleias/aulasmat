import { Link, useSearchParams } from "react-router-dom";
import { Globe } from "lucide-react";
import { CronysWordmark } from "@/components/brand";
import { isEnglish } from "@/lib/i18n";

/**
 * Língua das páginas legais (termos, privacidade, excluir conta). Por padrão,
 * a do app; `?lang=en` ou `?lang=pt` escolhe na hora, sem mexer na língua da
 * empresa - e o link com a língua pode ser mandado para alguém (Thiago, 27/09).
 */
export function useLegalEnglish(): boolean {
  const [params] = useSearchParams();
  const lang = params.get("lang");
  return lang === "en" ? true : lang === "pt" ? false : isEnglish();
}

/** Link para outra página legal, na mesma língua em que esta está. */
export const legalHref = (path: string, en: boolean) => `${path}?lang=${en ? "en" : "pt"}`;

/** Topo das páginas legais: a marca e o botão para a outra língua. */
export function LegalHeader({ en }: { en: boolean }) {
  return (
    <div className="mb-8 flex items-center justify-between gap-3">
      <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground">
        <CronysWordmark tamanho="1.125rem" className="text-foreground" />
      </Link>
      <Link to={`?lang=${en ? "pt" : "en"}`} replace lang={en ? "pt-BR" : "en"}
        className="flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-sm text-muted-foreground hover:bg-muted">
        <Globe className="h-4 w-4" aria-hidden /> {en ? "Português" : "English"}
      </Link>
    </div>
  );
}
