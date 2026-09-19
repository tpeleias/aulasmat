-- Cadastro aberto continua funcionando depois da segunda empresa.
--
-- Na parte 1, quem se cadastrava entrava na única empresa existente. Com duas
-- ou mais, ficava sem empresa - e sem empresa não se enxerga nada, então o
-- "Criar conta" da tela de login pararia de funcionar para os responsáveis.
--
-- Agora o cadastro entra na empresa dona do endereço, que é por onde a pessoa
-- chegou. Enquanto existe um endereço só, é sempre a empresa padrão; quando
-- cada empresa tiver o próprio endereço (parte 2), é ela que responde aqui.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _account uuid := public.public_account_id();
BEGIN
  INSERT INTO public.user_roles (user_id, role, account_id)
  VALUES (
    NEW.id,
    CASE WHEN (SELECT count(*) FROM public.user_roles
                WHERE role = 'admin' AND account_id IS NOT DISTINCT FROM _account) = 0
      THEN 'admin'::app_role
      ELSE 'student'::app_role
    END,
    _account
  );
  RETURN NEW;
END;
$$;
