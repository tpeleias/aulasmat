import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Erro precisa de tempo para ler (há mensagens de duas linhas, como a de
// horário ocupado no meio do caminho): 6 s, a não ser que a chamada diga outro.
// O app todo importa `toast` direto de "sonner"; é o mesmo objeto, então o
// ajuste vale para todos.
const plainError = toast.error;
toast.error = ((message, data) => plainError(message, { duration: 6000, ...data })) as typeof toast.error;

// Os avisos de "marcado", "salvo"... (Thiago, 02/10: reclamação de testador).
// No celular eles subiam por cima do menu de baixo e ficavam 4 s ou mais, a
// cada mudança. Agora sobem acima do menu (BottomNav + área segura do Android)
// e somem em 2,5 s; os que têm botão (Avisar no WhatsApp, Desfazer) passam a
// própria duração. O botão segue a cor da marca, não o preto padrão.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      duration={2500}
      mobileOffset={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))", left: "1rem", right: "1rem" }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground !rounded-lg",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
