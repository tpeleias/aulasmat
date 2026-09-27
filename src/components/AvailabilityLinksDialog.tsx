import { useState } from "react";
import { Copy, Search, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { teacherSlug, type Teacher } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";
import { availabilityUrl, copyAvailabilityLink } from "@/lib/availabilityLinks";
import { L } from "@/lib/i18n";

/**
 * Os links públicos de disponibilidade, um por profissional, juntos numa
 * janela (Thiago, 27/09): antes cada um era um botão no menu, e uma empresa
 * com 30 profissionais teria 30 botões lá. Com muitos, aparece a busca.
 */
export default function AvailabilityLinksDialog({ open, onOpenChange, teachers }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teachers: Teacher[];
}) {
  const [q, setQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const shown = teachers.filter(t => norm(t.name).includes(norm(q.trim())));
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) setQ(""); }}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{L("Links de disponibilidade", "Availability links")}</DialogTitle>
          <DialogDescription>
            {L("Uma página pública por profissional, com os horários livres. Mande para quem quer marcar.",
               "A public page per professional, with the free times. Send it to whoever wants to book.")}
          </DialogDescription>
        </DialogHeader>
        {teachers.length > 6 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder={L("Buscar pelo nome", "Search by name")}
              className="h-11 pl-9" aria-label={L("Buscar pelo nome", "Search by name")} />
          </div>
        )}
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {shown.map(t => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{capitalize(t.name)}</div>
                <div className="truncate text-xs text-muted-foreground">/disponibilidade/{teacherSlug(t.name)}</div>
              </div>
              {canShare && (
                <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0" aria-label={L(`Compartilhar o link de ${capitalize(t.name)}`, `Share ${capitalize(t.name)}'s link`)}
                  onClick={() => { navigator.share({ url: availabilityUrl(t), title: capitalize(t.name) }).catch(() => {}); }}>
                  <Share2 className="h-4 w-4" />
                </Button>
              )}
              <Button size="sm" variant="secondary" className="h-10 shrink-0 gap-1.5 rounded-xl" onClick={() => copyAvailabilityLink(t)}>
                <Copy className="h-3.5 w-3.5" /> {L("Copiar", "Copy")}
              </Button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">{L("Ninguém com esse nome.", "Nobody with that name.")}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
