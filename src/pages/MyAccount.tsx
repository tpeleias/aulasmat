import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft } from "lucide-react";
import AccountPanel from "@/components/AccountPanel";
import MeetingSettings from "@/components/MeetingSettings";
import { L } from "@/lib/i18n";

// Qualquer papel chega aqui (professor, responsável, aluno). Excluir a
// própria conta dentro do app é exigência da Google Play para apps com
// cadastro. O admin tem isto como a seção "Minha conta" das Configurações.
export default function MyAccount() {
  const { session, role, loading } = useAuth();

  if (loading) return null;
  if (!session) return <Navigate to="/entrar" replace />;
  if (role === "admin") return <Navigate to="/admin/configuracoes?secao=conta" replace />;

  const back = role === "teacher" ? "/admin" : role === "child" ? "/meu-painel" : "/aluno";

  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto w-full max-w-lg space-y-5 px-5 py-8">
        <Link to={back} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> {L("Voltar", "Back")}</Link>
        <h1 className="text-2xl font-bold">{L("Minha conta", "My account")}</h1>
        <AccountPanel />
        {/* O profissional escolhe o link das aulas on-line dele (05/10). */}
        {role === "teacher" && <MeetingSettings />}
        <p className="text-center text-xs text-muted-foreground">
          <Link to="/termos" className="underline">{L("Termos de uso", "Terms of use")}</Link> · <Link to="/privacidade" className="underline">{L("Privacidade", "Privacy")}</Link>
        </p>
      </div>
    </div>
  );
}
