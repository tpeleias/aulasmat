-- The backup table left behind by 20260912023210_derive_payment_status_from_wallet was
-- readable with the public anon key, exposing student names and lesson prices. Enabling RLS
-- with no policies makes it unreachable from the app while keeping the rows for recovery:
-- the service role still reads it, so the backup stays usable from the dashboard.
ALTER TABLE public.lessons_payment_status_backup_20260912 ENABLE ROW LEVEL SECURITY;
