import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Copy, QrCode, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import infinitepayLogo from "@/assets/infinitepay-logo.png";

type Props = {
  pixKey?: string | null;
  paymentLink?: string | null;
  compact?: boolean;
};

export function PaymentMethods({ pixKey, paymentLink, compact }: Props) {
  if (!pixKey && !paymentLink) return null;

  return (
    <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
      {pixKey && (
        <Card className="p-4 space-y-3 border-primary/30 bg-card">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <QrCode className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Pagamento via PIX</div>
              <div className="text-xs text-muted-foreground">Transferência instantânea</div>
            </div>
          </div>
          <div className="rounded-md bg-muted p-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Chave PIX</div>
              <div className="font-mono text-xs truncate">{pixKey}</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(pixKey);
                toast.success("Chave PIX copiada");
              }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      )}

      {paymentLink && (
        <Card className="p-4 space-y-3 border-primary/30 bg-card">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-foreground flex items-center justify-center p-1">
              <img src={infinitepayLogo} alt="InfinitePay" className="w-full h-full object-contain" />
            </div>
            <div>
              <div className="font-semibold text-sm">Pagamento com InfinitePay</div>
              <div className="text-xs text-muted-foreground">Cartão, boleto ou link</div>
            </div>
          </div>
          <Button asChild className="w-full gap-2">
            <a href={paymentLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4" />
              Abrir InfinitePay
            </a>
          </Button>
        </Card>
      )}
    </div>
  );
}
