import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { canSellHere } from "@/lib/subscription";

import { L } from "@/lib/i18n";
/**
 * O aviso de que algo é do Cronys Pro.
 *
 * Deliberadamente NÃO tem botão de compra nem link de pagamento. O app está na
 * Google Play, e vender bem digital dentro dele obriga a usar a cobrança do
 * Google - um link para pagar por fora é motivo de recusa na revisão. Aqui a
 * tela só informa e manda falar com quem cuida da conta; a troca de plano é
 * feita pelo gestor da plataforma.
 *
 * No SITE a regra não vale, e aí o aviso leva para /assinar.
 */
export function ProUpsell({
  titulo,
  children,
  icon: Icon = Sparkles,
  compacto = false,
}: {
  titulo: string;
  children: React.ReactNode;
  icon?: LucideIcon;
  compacto?: boolean;
}) {
  if (compacto) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          <strong className="text-foreground">{titulo}</strong> — {children}
          {canSellHere() && <> <Link to="/assinar" className="font-medium text-primary underline">{L("Ver planos", "See plans")}</Link></>}
        </span>
      </div>
    );
  }

  return (
    <Card className="mx-auto max-w-md rounded-2xl border-dashed p-6 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      {canSellHere() ? (
        <Link to="/assinar" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          {L("Ver planos e assinar", "See plans and subscribe")}
        </Link>
      ) : (
        <p className="mt-4 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {L(<>Sua conta está no <strong className="text-foreground">Cronys Essencial</strong>.
          Para mudar para o <strong className="text-foreground">Cronys Pro</strong>, fale
          com quem cuida da sua conta.</>, <>Your account is on <strong className="text-foreground">Cronys Essential</strong>.
          To move to <strong className="text-foreground">Cronys Pro</strong>, talk to whoever manages your account.</>)}
        </p>
      )}
    </Card>
  );
}
