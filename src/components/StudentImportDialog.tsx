import { useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWords } from "@/hooks/useVocabulary";
import { dbErrorMessage } from "@/lib/dbErrors";
import { haptics } from "@/lib/haptics";
import { parseStudents } from "@/lib/studentImport";

type Existing = { student_name: string; guardian_name: string | null };

/**
 * Cadastro de vários clientes de uma vez: colar da planilha ou abrir um CSV,
 * conferir a lista e gravar. Repetidos (mesmo nome e responsável) não entram.
 *
 * `room` é quantos ainda cabem no plano (nulo = sem limite). O banco confere o
 * limite de novo em cada linha (enforce_plan_limit); aqui é para a pessoa ver
 * antes quantos vão entrar, em vez de a gravação inteira falhar.
 */
export default function StudentImportDialog({ open, onOpenChange, existing, room, onImported }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: Existing[];
  room: number | null;
  onImported: () => void;
}) {
  const w = useWords();
  const c = w.client;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const lines = useMemo(() => parseStudents(text, existing), [text, existing]);
  const fresh = lines.filter(l => l.status === "novo");
  const toImport = room === null ? fresh : fresh.slice(0, Math.max(0, room));
  const overLimit = fresh.length - toImport.length;

  const close = (v: boolean) => { if (!busy) { onOpenChange(v); if (!v) setText(""); } };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (/\.(xlsx?|ods|numbers)$/i.test(f.name)) {
      toast.error("Esse arquivo é de planilha. Salve como CSV, ou selecione as colunas na planilha, copie e cole aqui.");
      return;
    }
    // O Excel em português salva CSV em Windows-1252; se o UTF-8 der
    // caractere quebrado, relê no outro.
    const buf = await f.arrayBuffer();
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf);
    setText(t);
  };

  const save = async () => {
    if (toImport.length === 0) return;
    setBusy(true);
    let done = 0;
    for (let i = 0; i < toImport.length; i += 100) {
      const chunk = toImport.slice(i, i + 100).map(({ student_name, guardian_name, address }) => ({ student_name, guardian_name, address }));
      const { error } = await supabase.from("students").insert(chunk);
      if (error) {
        setBusy(false);
        haptics.warning();
        toast.error(`${done} ${c.pick("cadastrado", "cadastrada")}${done === 1 ? "" : "s"}; o resto parou: ${dbErrorMessage(error, w)}`);
        if (done > 0) onImported();
        return;
      }
      done += chunk.length;
    }
    setBusy(false);
    haptics.success();
    toast.success(`${done} ${done === 1 ? c.l : c.lp} ${c.pick("cadastrado", "cadastrada")}${done === 1 ? "" : "s"}`);
    setText("");
    onOpenChange(false);
    onImported();
  };

  const statusLabel = { novo: "", repetido_no_cadastro: "já cadastrado", repetido_na_planilha: "repetido" } as const;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Importar {c.lp}</DialogTitle>
          <DialogDescription>
            Na planilha, selecione as colunas <b>nome</b>, <b>{w.guardian.l}</b> e <b>endereço</b> (nessa ordem, ou com
            cabeçalho), copie e cole abaixo. Também dá para abrir um arquivo CSV.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={6}
          className="rounded-xl font-mono text-xs"
          placeholder={"Nome\tResponsável\tEndereço\nAna Souza\tMaria Souza\tRua A, 10\nBruno Lima\tCarlos Lima\t"}
        />
        <div>
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="hidden"
            onChange={e => { readFile(e.target.files?.[0]); e.target.value = ""; }} />
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => fileRef.current?.click()}>
            <FileUp className="mr-1.5 h-4 w-4" /> Abrir arquivo CSV
          </Button>
        </div>

        {lines.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm">
              <b>{toImport.length}</b> para cadastrar
              {lines.length - fresh.length > 0 && ` · ${lines.length - fresh.length} repetido${lines.length - fresh.length === 1 ? "" : "s"} (fica${lines.length - fresh.length === 1 ? "" : "m"} de fora)`}
            </p>
            {overLimit > 0 && (
              <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                O plano atual comporta mais {room} {room === 1 ? c.l : c.lp}. {overLimit} {overLimit === 1 ? "fica" : "ficam"} de fora -
                {" "}os primeiros da lista entram.
              </p>
            )}
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm">
              {lines.map(l => (
                <li key={l.line} className={`flex items-center justify-between gap-2 px-3 py-1.5 ${l.status !== "novo" ? "text-muted-foreground line-through" : ""}`}>
                  <span className="min-w-0 truncate">
                    {l.student_name}
                    {l.guardian_name && <span className="text-muted-foreground"> · {l.guardian_name}</span>}
                  </span>
                  {l.status !== "novo" && <span className="shrink-0 text-[10px] no-underline">{statusLabel[l.status]}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => close(false)} disabled={busy}>Cancelar</Button>
          <Button className="rounded-xl" onClick={save} disabled={busy || toImport.length === 0}>
            {busy ? "Cadastrando…" : `Cadastrar ${toImport.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
