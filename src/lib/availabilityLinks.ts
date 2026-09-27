import { toast } from "sonner";
import { teacherSlug, type Teacher } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";
import { haptics } from "@/lib/haptics";
import { publicSiteUrl } from "@/lib/publicUrl";
import { L } from "@/lib/i18n";

export const availabilityUrl = (t: Pick<Teacher, "name">) => `${publicSiteUrl()}/disponibilidade/${teacherSlug(t.name)}`;

export function copyAvailabilityLink(t: Pick<Teacher, "name">) {
  navigator.clipboard.writeText(availabilityUrl(t));
  haptics.success();
  toast.success(L(`Link de ${capitalize(t.name)} copiado!`, `Link for ${capitalize(t.name)} copied!`));
}

