import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
export const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

// Dia num calendário e hora/minuto (de 5 em 5) em duas listas curtas, no lugar do
// datetime-local: no celular aquele abre um relógio de ponteiro, e acertar
// 15:30 arrastando ponteiro era a queixa.
//
// value/onChange no formato "yyyy-MM-ddTHH:mm", hora local - o mesmo que o
// datetime-local usava, então o resto do diálogo não muda. Só emite quando os
// três pedaços existem; enquanto isso guarda o que já foi escolhido.
export function DateTimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");

  useEffect(() => {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (m) { setDate(m[1]); setHour(m[2]); setMinute(m[3]); }
  }, [value]);

  const set = (d: string, h: string, mi: string) => {
    setDate(d); setHour(h); setMinute(mi);
    if (d && h && mi) onChange(`${d}T${h}:${mi}`);
  };

  // Uma aula antiga às 16:42 continua 16:42: o minuto dela entra na lista em
  // vez de ser trocado em silêncio pelo mais próximo.
  const minutes = minute && !MINUTE_OPTIONS.includes(minute) ? [...MINUTE_OPTIONS, minute].sort() : MINUTE_OPTIONS;
  const complete = date && hour && minute;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <Input type="date" value={date} onChange={e => set(e.target.value, hour, minute)} className="min-w-0" />
        <Select value={hour} onValueChange={h => set(date, h, minute || "00")}>
          <SelectTrigger className="w-[4.5rem]"><SelectValue placeholder="Hora" /></SelectTrigger>
          <SelectContent className="max-h-64">
            {HOURS.map(h => <SelectItem key={h} value={h}>{h}h</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={minute} onValueChange={mi => set(date, hour, mi)}>
          <SelectTrigger className="w-[4.5rem]"><SelectValue placeholder="Min" /></SelectTrigger>
          <SelectContent>
            {minutes.map(mi => <SelectItem key={mi} value={mi}>:{mi}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {complete && (
        <p className="text-xs text-muted-foreground first-letter:uppercase">
          {format(new Date(`${date}T${hour}:${minute}`), "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
        </p>
      )}
    </div>
  );
}
