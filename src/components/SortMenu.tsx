import { useCallback, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { haptics } from "@/lib/haptics";

export type SortOption<T extends string> = { key: T; label: string };

// The chosen order sticks per screen, so the app opens the way it was left.
export function useSortPreference<T extends string>(storageKey: string, options: SortOption<T>[], fallback: T) {
  const [sort, setSort] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(`sort:${storageKey}`);
      if (saved && options.some(o => o.key === saved)) return saved as T;
    } catch {
      // private mode or blocked storage: the default order is fine
    }
    return fallback;
  });

  const choose = useCallback((value: T) => {
    setSort(value);
    try { localStorage.setItem(`sort:${storageKey}`, value); } catch { /* not worth failing over */ }
  }, [storageKey]);

  return [sort, choose] as const;
}

export default function SortMenu<T extends string>({ value, options, onChange, className = "" }: {
  value: T;
  options: SortOption<T>[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const current = options.find(o => o.key === value) ?? options[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={() => haptics.tap()}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted ${className}`}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          <span className="max-w-[9rem] truncate">{current.label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl">
        <DropdownMenuRadioGroup value={value} onValueChange={v => { haptics.tap(); onChange(v as T); }}>
          {options.map(o => (
            <DropdownMenuRadioItem key={o.key} value={o.key} className="rounded-lg text-sm">
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
