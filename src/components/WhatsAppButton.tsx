import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";

type WhatsAppButtonProps = {
  teacher: string;
  settings: any;
  message: string;
};

export function WhatsAppButton({ teacher, settings, message }: WhatsAppButtonProps) {
  const num = teacher === "mayara" ? settings?.whatsapp_mayara : settings?.whatsapp_thiago;
  if (!num) return null;
  const clean = String(num).replace(/\D/g, "");
  return (
    <Button asChild size="sm" variant="outline" className="gap-1">
      <a href={`https://wa.me/${clean}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="w-4 h-4" /> WhatsApp
      </a>
    </Button>
  );
}