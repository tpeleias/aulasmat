import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Copy, QrCode, ExternalLink, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import infinitepayLogo from "@/assets/infinitepay-logo.png";
import { buildPixPayload } from "@/lib/pix";
import { fmtMoney } from "@/lib/balance";

// O que vem de settings. Cada empresa diz o nome do próprio link de
// pagamento - antes era "InfinitePay" cravado para todas.
export type PaymentSettings = {
  pix_key?: string | null;
  payment_link?: string | null;
  payment_link_label?: string | null;
  payment_link_note?: string | null;
  pix_receiver_name?: string | null;
  pix_city?: string | null;
};

type Props = {
  settings: PaymentSettings;
  // Quanto a família deve: com ele, o Pix "copia e cola" já vai com o valor.
  amount?: number;
  compact?: boolean;
};

export function PaymentMethods({ settings, amount, compact }: Props) {
  const pixKey = settings.pix_key?.trim() || null;
  const paymentLink = settings.payment_link?.trim() || null;
  if (!pixKey && !paymentLink) return null;

  const label = settings.payment_link_label?.trim() || "Link de pagamento";
  const isInfinitePay = /infinitepay/i.test(label) || /infinitepay/i.test(paymentLink ?? "");
  const pixCode = pixKey && amount && amount > 0
    ? buildPixPayload({ key: pixKey, name: settings.pix_receiver_name ?? "", city: settings.pix_city ?? "", amount })
    : null;

  const copy = (text: string, msg: string) => { navigator.clipboard.writeText(text); toast.success(msg); };

  return (
    <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
      {pixKey && (
        <Card className="p-4 space-y-3 border-primary/30 bg-card">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <QrCode className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Pagamento via Pix</div>
              <div className="text-xs text-muted-foreground">Transferência instantânea</div>
            </div>
          </div>
          {pixCode && (
            <Button className="w-full gap-2" onClick={() => copy(pixCode, "Código Pix copiado - cole no app do seu banco")}>
              <Copy className="w-4 h-4" /> Copiar Pix de {fmtMoney(amount!)}
            </Button>
          )}
          <div className="rounded-md bg-muted p-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Chave Pix</div>
              <div className="font-mono text-xs truncate">{pixKey}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => copy(pixKey, "Chave Pix copiada")} aria-label="Copiar chave Pix">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          {pixCode && <p className="text-[11px] text-muted-foreground">O código já vai com o valor em aberto; no app do banco, use "Pix copia e cola".</p>}
        </Card>
      )}

      {paymentLink && (
        <Card className="p-4 space-y-3 border-primary/30 bg-card">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isInfinitePay ? "bg-white p-1" : "bg-primary/10"}`}>
              {isInfinitePay
                ? <img src={infinitepayLogo} alt="InfinitePay" className="w-full h-full object-contain" />
                : <LinkIcon className="w-5 h-5 text-primary" />}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm">{label}</div>
              {settings.payment_link_note?.trim() && <div className="text-xs text-muted-foreground">{settings.payment_link_note}</div>}
            </div>
          </div>
          <Button asChild className="w-full gap-2">
            <a href={paymentLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4" />
              Abrir {label}
            </a>
          </Button>
        </Card>
      )}
    </div>
  );
}
