import { useAuth } from "@/hooks/useAuth";

export function useDefaultTeacher(): string {
  const { user } = useAuth();
  const email = (user?.email ?? "").toLowerCase();
  if (email.includes("mayara")) return "mayara";
  return "thiago";
}
