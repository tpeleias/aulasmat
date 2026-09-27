-- Gestor: redefinir a senha de um login (Thiago, 27/09).
--
-- A troca da senha em si é da API de autenticação (função platform-console,
-- ação reset_password). Aqui só se acha o login pelo e-mail - auth.users não é
-- alcançável pela API REST - e se diz a que empresa e papel ele pertence, para
-- a tela mostrar de quem é a senha que acabou de mudar.
--
-- Chamada com o token de quem pediu: is_platform_admin() vale para quem chamou
-- de verdade (a segunda guarda, como nas outras platform_*).

CREATE OR REPLACE FUNCTION public.platform_login_lookup(_email text)
RETURNS TABLE (user_id uuid, email text, account_name text, role text, is_operator boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text,
           (SELECT a.name FROM public.user_roles r JOIN public.accounts a ON a.id = r.account_id
             WHERE r.user_id = u.id ORDER BY r.role LIMIT 1),
           (SELECT r.role::text FROM public.user_roles r WHERE r.user_id = u.id ORDER BY r.role LIMIT 1),
           EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id = u.id)
      FROM auth.users u
     WHERE lower(u.email) = lower(btrim(_email))
     LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.platform_login_lookup(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_login_lookup(text) TO authenticated;
