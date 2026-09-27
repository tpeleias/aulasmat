import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { WheelPicker } from "@/components/WheelPicker";
import { useIsMobile } from "@/hooks/use-mobile";
import { L } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type WheelOption = { value: string; label: string; disabled?: boolean };

/**
 * Caixa de seleção que, no celular, abre uma gaveta de baixo com a rodinha
 * (Thiago, 27/09): a lista aberta inteira passava da tela. No computador
 * continua a lista de sempre, que ali cabe e é mais rápida com o mouse.
 */
export function WheelSelect({ value, onValueChange, options, label, placeholder, disabled, className }: {
  value: string;
  onValueChange: (v: string) => void;
  options: WheelOption[];
  /** Nome do campo: título da gaveta e rótulo para leitor de tela. */
  label: string;
  placeholder?: ReactNode;
  disabled?: boolean;
  /** Classes do botão (largura, altura), as mesmas que iam no SelectTrigger. */
  className?: string;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (!mobile) {
    return (
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className={className} aria-label={label}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map(o => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  const current = options.find(o => o.value === value);
  const choices = options.filter(o => !o.disabled || o.value === value);
  const labelOf = (v: string) => choices.find(o => o.value === v)?.label ?? v;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("truncate", !current && "text-muted-foreground")}>{current ? current.label : placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
        <DrawerContent>
          <DrawerHeader className="pb-1">
            <DrawerTitle className="text-center">{label}</DrawerTitle>
            <DrawerDescription className="sr-only">{L("Role para escolher", "Scroll to choose")}</DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <WheelPicker
              rows={5}
              className="mx-auto max-w-sm"
              label={label}
              options={choices.map(o => o.value)}
              value={value}
              format={labelOf}
              onChange={onValueChange}
            />
          </div>
          <DrawerFooter>
            <Button className="mx-auto h-11 w-full max-w-sm rounded-xl" onClick={() => {
              // Abriu e fechou sem rolar, com o campo vazio: fica com a primeira.
              if (!current && choices[0]) onValueChange(choices[0].value);
              setOpen(false);
            }}>{L("Pronto", "Done")}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
