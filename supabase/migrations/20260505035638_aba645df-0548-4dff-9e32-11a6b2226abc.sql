
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS teacher text NOT NULL DEFAULT 'thiago';

CREATE TABLE IF NOT EXISTS public.block_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(block_id, exception_date)
);

ALTER TABLE public.block_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage block_exceptions" ON public.block_exceptions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Update get_recurring_blocks to include id and exceptions list for public availability
CREATE OR REPLACE FUNCTION public.get_recurring_blocks_v2()
RETURNS TABLE(id uuid, weekday integer, start_time time, end_time time, exceptions date[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.weekday, b.start_time, b.end_time,
    COALESCE(ARRAY(SELECT exception_date FROM public.block_exceptions WHERE block_id = b.id), ARRAY[]::date[])
  FROM public.blocks b WHERE b.block_type = 'recurring'
$$;
