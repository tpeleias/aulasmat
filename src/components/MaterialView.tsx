import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { BookOpen, Download, ExternalLink, FileText, Link2, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { L } from "@/lib/i18n";

/**
 * Um material do aluno (11/10): arquivo enviado, link (Drive, YouTube...) ou
 * página escrita - texto em Markdown com fórmulas ($x^2$), que a IA manda
 * pelo conector. A página abre aqui mesmo e "Salvar em PDF" usa a impressão
 * do navegador, que já sai com as fórmulas desenhadas.
 */
export type Material = {
  id: string; title: string; created_at: string; kind?: string | null;
  file_path?: string | null; url?: string | null; content?: string | null; uploaded_by?: string | null;
};

export function materialKind(m: Material): "file" | "link" | "page" {
  return m.kind === "link" || m.kind === "page" ? m.kind : "file";
}

export function MaterialIcon({ m, className = "h-4 w-4 shrink-0 text-primary" }: { m: Material; className?: string }) {
  const k = materialKind(m);
  return k === "link" ? <Link2 className={className} /> : k === "page" ? <BookOpen className={className} /> : <FileText className={className} />;
}

export function MarkdownPage({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown>
    </div>
  );
}

/** Imprime só a página do material (o diálogo inteiro sairia com o app atrás). */
function printPage(title: string, el: HTMLElement | null) {
  if (!el) return;
  const w = window.open("", "_blank");
  if (!w) { window.print(); return; }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(n => n.outerHTML).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title>${styles}
    <style>body{background:#fff;color:#111;padding:32px;font-family:system-ui,sans-serif} h1.mt{font-size:20px;margin:0 0 16px}</style></head>
    <body><h1 class="mt">${title.replace(/</g, "&lt;")}</h1>${el.innerHTML}</body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

/** Botão que abre o material do jeito certo para o tipo dele. */
export function MaterialOpenButton({ m, label }: { m: Material; label?: string }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState<HTMLDivElement | null>(null);
  const k = materialKind(m);

  if (k === "link") {
    return (
      <Button size="sm" variant="outline" className="gap-1" asChild>
        <a href={m.url ?? "#"} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> {label ?? L("Abrir", "Open")}</a>
      </Button>
    );
  }
  if (k === "page") {
    return (
      <>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}><BookOpen className="h-4 w-4" /> {label ?? L("Ler", "Read")}</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto rounded-2xl">
            <DialogHeader><DialogTitle>{m.title}</DialogTitle></DialogHeader>
            <div ref={setRef}><MarkdownPage content={m.content ?? ""} /></div>
            <div className="flex justify-end">
              <Button variant="outline" className="gap-1.5 rounded-xl" onClick={() => printPage(m.title, ref)}>
                <Printer className="h-4 w-4" /> {L("Salvar em PDF / imprimir", "Save as PDF / print")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  const download = async () => {
    if (!m.file_path) return;
    const { data } = await supabase.storage.from("student-materials").createSignedUrl(m.file_path, 60);
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl; a.download = m.title; a.target = "_blank"; a.rel = "noopener"; a.click();
    }
  };
  return <Button size="sm" variant="outline" className="gap-1" onClick={download}><Download className="h-4 w-4" /> {label ?? L("Baixar", "Download")}</Button>;
}
