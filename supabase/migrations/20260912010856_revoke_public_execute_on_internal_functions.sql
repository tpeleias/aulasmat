-- mark_past_lessons_realizada writes to lessons and was reachable unauthenticated over
-- /rest/v1/rpc. Only pg_cron needs it. current_student and get_recurring_blocks_v2 are unused.
-- The availability helpers (get_busy_ranges*, get_recurring_blocks*) stay public on purpose:
-- the shareable availability page reads them without a login.
REVOKE EXECUTE ON FUNCTION public.mark_past_lessons_realizada() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_student() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recurring_blocks_v2() FROM anon, authenticated;

-- These are only ever evaluated inside RLS policies for signed-in users.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.student_account_matches(text, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_child_lessons() FROM anon;
