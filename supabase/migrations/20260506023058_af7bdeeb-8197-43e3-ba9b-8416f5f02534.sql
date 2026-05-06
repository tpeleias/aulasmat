ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS scarcity_weekday_max integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS scarcity_weekday_min integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scarcity_weekend_max integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS scarcity_weekend_min integer NOT NULL DEFAULT 3;