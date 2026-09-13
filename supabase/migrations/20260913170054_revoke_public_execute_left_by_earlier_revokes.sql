-- 20260912010856 and 20260912023210 revoked EXECUTE from anon and authenticated, but both
-- functions kept the EXECUTE that Postgres grants to PUBLIC when a function is created, and
-- PUBLIC covers those roles: mark_past_lessons_realizada (writes to lessons, which cascades
-- into wallet charges) stayed callable with the anon key alone. Revoking from PUBLIC is what
-- those migrations meant to do. The cron job runs as postgres and the recompute runs from
-- triggers as the definer, so neither path needs a client-facing grant.
REVOKE EXECUTE ON FUNCTION public.mark_past_lessons_realizada() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_payment_status(text, text) FROM PUBLIC;
