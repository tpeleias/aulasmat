import { useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { X } from "lucide-react";

import { dateLocale, L } from "@/lib/i18n";
// A função do banco devolve um código, não uma mensagem: quem decide como falar
// com a família é a tela. "ja-respondido" é o caso interessante - acontece
// quando o admin aprovou entre a família abrir a tela e apertar o botão, e a
// resposta certa não é "deu erro", é contar o que aconteceu.
const MENSAGENS: Record<string, string> = {
  ok: L("Pedido retirado. O horário volta a ficar livre.", "Request withdrawn. The time is free again."),
  "ja-respondido": L("Esse pedido já foi respondido — não dá mais para retirar. Veja na lista como ficou.", "This request was already answered — it can't be withdrawn. Check the list to see the result."),
  "nao-encontrado": L("Não encontramos esse pedido.", "We couldn't find this request."),
  "sem-empresa": L("Sua conta não está vinculada. Avise quem te atende.", "Your account isn't linked. Let your provider know."),
};

/**
 * Retira um pedido de aula que ainda não foi respondido.
 *
 * Só aparece para o responsável, e só em pedido pendente: depois de aprovado ou
 * recusado, quem manda é quem respondeu. O botão existe porque um pedido ocupa o
 * horário - sem ele, um toque errado prendia o slot até alguém recusar.
 */
export function WithdrawRequestButton({
  lessonId, startAt, onDone,
}: { lessonId: string; startAt: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const withdraw = async () => {
    setOpen(false);
    setBusy(true);
    const { data, error } = await supabase.rpc("cancel_own_lesson_request", {
      _lesson_id: lessonId,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const codigo = String(data ?? "");
    if (codigo === "ok") toast.success(MENSAGENS.ok);
    else toast.error(MENSAGENS[codigo] ?? L("Não foi possível retirar o pedido.", "Could not withdraw the request."));
    // Recarrega mesmo quando não deu "ok": se o admin respondeu no meio, a lista
    // na tela está velha e precisa mostrar o que de fato aconteceu.
    onDone?.();
  };

  return (
    <>
      <Button
        size="sm" variant="ghost" className="h-8 rounded-xl text-muted-foreground"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <X className="mr-1 h-3.5 w-3.5" /> {L("Retirar", "Withdraw")}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{L("Retirar este pedido?", "Withdraw this request?")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="text-foreground font-medium">
                  {format(new Date(startAt), L("EEEE, dd 'de' MMMM 'às' HH:mm", "EEEE, MMMM d 'at' HH:mm"), { locale: dateLocale() })}
                </p>
                <p>
                  {L("O horário volta a ficar livre e o pedido sai da lista de pedidos. Você pode pedir outro horário depois.", "The time becomes free again and the request leaves the list. You can request another time later.")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{L("Voltar", "Back")}</AlertDialogCancel>
            <AlertDialogAction onClick={withdraw}>{L("Retirar pedido", "Withdraw request")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
