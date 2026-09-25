import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";

import { L } from "@/lib/i18n";
export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <Button
      onClick={toggleTheme}
      variant="ghost"
      size="sm"
      className={`w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent ${className ?? ""}`}
      aria-label={isDark ? L("Ativar modo claro", "Switch to light mode") : L("Ativar modo escuro", "Switch to dark mode")}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      {isDark ? L("Modo claro", "Light mode") : L("Modo escuro", "Dark mode")}
    </Button>
  );
}
