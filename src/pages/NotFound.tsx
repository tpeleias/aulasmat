import { Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

import { L } from "@/lib/i18n";
const NotFound = () => {
  const location = useLocation();
  const { role, loading } = useAuth();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  if (!loading && role === "child" && /financeiro|cobranca|pagamento|saldo/i.test(location.pathname)) {
    return <Navigate to="/meu-painel" replace />;
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{L("Esta página não existe.", "This page doesn't exist.")}</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          {L("Voltar ao início", "Back to home")}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
