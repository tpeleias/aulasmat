import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setPushNavigator } from "@/lib/push";

/** Liga o toque na notificação ao roteador do app. */
export function PushBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setPushNavigator(to => navigate(to));
    return () => setPushNavigator(null);
  }, [navigate]);
  return null;
}
