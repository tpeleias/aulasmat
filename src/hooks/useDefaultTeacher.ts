import { useAuth } from "@/hooks/useAuth";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";

// Qual professor da empresa corresponde a quem está logado.
//
// Antes isto era "se o e-mail tem 'mayara', é a Mayara; senão é o Thiago" - com
// nome cravado no código. O resultado é que o admin de qualquer outra empresa
// era saudado como Thiago. Agora a comparação é contra os professores da
// própria empresa, e sem palpite: quem não corresponde a ninguém cai no
// primeiro da lista, que é o professor daquela empresa.
export function useDefaultTeacher(): string {
  const { user } = useAuth();
  const { teachers } = useTeachers(true);

  const email = (user?.email ?? "").toLowerCase();
  const slugs = teachers.map(t => teacherSlug(t.name));

  const fromEmail = slugs.find(slug => slug && email.includes(slug));
  return fromEmail ?? slugs[0] ?? "";
}
