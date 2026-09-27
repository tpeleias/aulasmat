import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type Props = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (n: number) => void;
  /** Valor usado quando o campo fica vazio ao sair dele. Padrão: min, ou 0. */
  fallback?: number;
};

/**
 * Campo numérico que deixa apagar tudo e digitar de novo (Thiago, 27/09).
 *
 * Com `value={n}` e `onChange={Number(...) || 1}`, apagar o "1" fazia o campo
 * voltar a "1" na hora, e só dava para digitar depois dele ("14" em vez de
 * "4"). Aqui o que se digita fica como texto enquanto o campo está em uso; o
 * número vai para fora a cada tecla quando é válido, e o vazio só vira o
 * `fallback` ao sair do campo.
 */
export function NumberField({ value, onValueChange, fallback, min, max, onBlur, onFocus, ...rest }: Props) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // Mudou por fora (um botão de atalho, um serviço escolhido): mostra o novo.
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);

  const clamp = (n: number) => {
    if (min !== undefined && n < Number(min)) return Number(min);
    if (max !== undefined && n > Number(max)) return Number(max);
    return n;
  };

  return (
    <Input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={editing ? text : String(value)}
      onFocus={e => { setEditing(true); setText(String(value)); onFocus?.(e); }}
      onChange={e => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(",", "."));
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onValueChange(n);
      }}
      onBlur={e => {
        setEditing(false);
        const n = Number(text.replace(",", "."));
        const final = text.trim() === "" || !Number.isFinite(n)
          ? (fallback ?? (min !== undefined ? Number(min) : 0))
          : clamp(n);
        if (final !== value) onValueChange(final);
        onBlur?.(e);
      }}
    />
  );
}
