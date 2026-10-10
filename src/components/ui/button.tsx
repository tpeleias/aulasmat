import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-[transform,box-shadow,background-color,border-color,filter] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // O dourado #c9a24b do spec, cheio, nos dois modos: "gold: marca,
        // acento principal, botões". Ele vale como PREENCHIMENTO em qualquer
        // fundo, porque quem precisa de contraste aí é o texto por cima, e
        // esse é navy (7,65:1). O que não vale é dourado como TEXTO em
        // superfície clara - por isso `--primary`, que também pinta link e
        // ícone, é uma versão escurecida no modo claro.
        //
        // Visual de 08/10 ("está muito sóbrio"): o mesmo dourado, com um
        // degradê curto do próprio matiz e uma sombra dourada, para o botão
        // principal saltar da tela. Degradê é de superfície de tela, não da
        // marca - o spec só o proíbe no símbolo e no fundo do ícone.
        default: "bg-brand-gold bg-[image:var(--gradient-primary)] text-brand-navy shadow-[0_6px_16px_-6px_hsl(var(--brand-gold)/0.7)] hover:shadow-[0_8px_22px_-6px_hsl(var(--brand-gold)/0.85)] hover:brightness-[1.04]",
        destructive: "bg-destructive text-destructive-foreground shadow-[0_6px_16px_-8px_hsl(var(--destructive)/0.7)] hover:bg-destructive/90",
        outline: "border border-primary/25 bg-card text-foreground shadow-sm hover:border-primary/50 hover:bg-primary/5",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-xl px-3",
        lg: "h-12 rounded-2xl px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
