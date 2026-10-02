import { toast } from "sonner";
import { teacherSlug, type Teacher } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";
import { haptics } from "@/lib/haptics";
import { publicSiteUrl } from "@/lib/publicUrl";
import { L } from "@/lib/i18n";

/**
 * O endereço da página de horários: `/horarios/<empresa>/<profissional>`, ou
 * `/horarios/<empresa>` para a empresa toda. <empresa> é o código da empresa
 * (accounts.slug, `school_code` do my_plan). Antes era `/disponibilidade/...`,
 * que sem login só servia a empresa do endereço público (migration
 * 20261002010000). O endereço antigo continua funcionando para ela.
 */
export const availabilityPath = (account: string, t?: Pick<Teacher, "name">) =>
  `/horarios/${account}${t ? `/${teacherSlug(t.name)}` : ""}`;

export const availabilityUrl = (account: string, t?: Pick<Teacher, "name">) => `${publicSiteUrl()}${availabilityPath(account, t)}`;

export function copyAvailabilityLink(account: string, t?: Pick<Teacher, "name">) {
  navigator.clipboard.writeText(availabilityUrl(account, t));
  haptics.success();
  toast.success(t
    ? L(`Link de ${capitalize(t.name)} copiado!`, `Link for ${capitalize(t.name)} copied!`)
    : L("Link da agenda toda copiado!", "Link for the whole schedule copied!"));
}
