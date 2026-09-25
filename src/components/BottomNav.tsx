import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { haptics } from "@/lib/haptics";

import { L } from "@/lib/i18n";
export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

// Mobile-only tab bar. Desktop keeps the sidebar (rendered by the layout).
export default function BottomNav({ items, more, moreTitle = L("Mais", "More") }: {
  items: NavItem[];
  more?: (close: () => void) => ReactNode;
  moreTitle?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const cols = items.length + (more ? 1 : 0);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 md:hidden border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label={L("Navegação principal", "Main navigation")}
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {items.map(it => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={() => haptics.tap()}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
            >
              {({ isActive }) => (
                <>
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${isActive ? "bg-primary/10" : ""}`}>
                    <it.icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  {it.label}
                </>
              )}
            </NavLink>
          ))}
          {more && (
            <button
              type="button"
              onClick={() => { haptics.tap(); setMoreOpen(true); }}
              className="flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium text-muted-foreground"
            >
              <span className="flex h-7 w-12 items-center justify-center rounded-full">
                <MoreHorizontal className="h-5 w-5" />
              </span>
              {moreTitle}
            </button>
          )}
        </div>
      </nav>

      {more && (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl border-t-0 px-5 pt-5" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            <SheetTitle className="sr-only">{moreTitle}</SheetTitle>
            {more(() => setMoreOpen(false))}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
