DELETE FROM public.user_roles
WHERE role = 'student'
  AND user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'child');