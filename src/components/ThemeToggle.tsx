import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";

export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <Button
      onClick={toggleTheme}
      variant="ghost"
      size="sm"
      className={`w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent ${className ?? ""}`}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      {isDark ? "Modo claro" : "Modo escuro"}
    </Button>
  );
}
