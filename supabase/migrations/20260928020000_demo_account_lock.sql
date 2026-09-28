-- Conta de teste travada (Thiago, 28/09): o login HiveApp é usado pelos
-- testadores do Hive, e a senha publicada lá (HiveTester) tem de continuar
-- valendo. Quem entra nele não troca a senha, não troca o e-mail e não
-- exclui a conta.
--
-- A marca fica em app_metadata.demo_account, que o usuário não consegue
-- editar (só o service role). O app lê a marca e mostra um aviso no lugar
-- do formulário; o gatilho abaixo garante o mesmo por qualquer caminho
-- (redefinição pelo gestor, função de excluir conta, API direta).
--
-- Para mexer de propósito numa conta dessas: primeiro tire a marca
--   UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'demo_account' WHERE ...
-- e depois troque a senha.

CREATE OR REPLACE FUNCTION public.protect_demo_account()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(OLD.raw_app_meta_data ->> 'demo_account', '') <> 'true' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Conta de teste: não é permitido excluir.' USING HINT = 'conta_teste';
  END IF;
  -- Tirar a marca (service role) é permitido, e nessa mesma mudança nada mais.
  IF coalesce(NEW.raw_app_meta_data ->> 'demo_account', '') <> 'true' THEN
    IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password OR NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Conta de teste: tire a marca antes de mudar a senha ou o e-mail.' USING HINT = 'conta_teste';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Conta de teste: não é permitido mudar a senha nem o e-mail.' USING HINT = 'conta_teste';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_demo_account ON auth.users;
CREATE TRIGGER protect_demo_account
  BEFORE UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_demo_account();

-- A conta do Hive.
UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"demo_account": true}'::jsonb
 WHERE email = 'hiveapp@aluno.sistema.local';
