DROP POLICY IF EXISTS "anyone reads settings" ON public.settings;

CREATE POLICY "anon reads settings"
ON public.settings
FOR SELECT
TO anon
USING (true);

CREATE POLICY "authenticated non-child reads settings"
ON public.settings
FOR SELECT
TO authenticated
USING (NOT public.has_role(auth.uid(), 'child'::app_role));