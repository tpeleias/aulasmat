import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";

type WhatsAppButtonProps = {
  teacher: string;
  message: string;
};

// O número é do professor, e só aparece se ele autorizou: desligar o botão nas
// configurações do professor esconde daqui sem apagar o contato.
export function WhatsAppButton({ teacher, message }: WhatsAppButtonProps) {
  const { teachers } = useTeachers(true);
  const found = teachers.find(t => teacherSlug(t.name) === teacher);
  if (!found || found.whatsapp_enabled === false) return null;

  const clean = String(found.whatsapp ?? "").replace(/\D/g, "");
  if (!clean) return null;

  return (
    <Button asChild size="sm" variant="outline" className="gap-1">
      <a href={`https://wa.me/${clean}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="w-4 h-4" /> WhatsApp
      </a>
    </Button>
  );
}
