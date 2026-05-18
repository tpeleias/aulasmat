import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type StudentRow = {
  id: string; student_name: string; guardian_name: string | null; address: string | null; user_id: string | null;
  must_change_password?: boolean;
};

export function useStudent() {
  const { user } = useAuth();
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user) { setStudent(null); setLoading(false); return; }
    supabase.from("students").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      setStudent(data as any);
      setLoading(false);
    });
  }, [user]);
  return { student, loading };
}

export type AppSettings = {
  pix_key: string | null; payment_link: string | null;
  show_payment_info_to_students: boolean;
  whatsapp_thiago: string | null; whatsapp_mayara: string | null;
  allow_student_booking: boolean;
  show_availability_to_students: boolean;
  work_start: string; work_end: string; slot_minutes: number;
};
export function useAppSettings() {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => {
    supabase.from("settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => setS(data as any));
  }, []);
  return s;
}
