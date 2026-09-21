-- Stubs do que o Supabase entrega pronto e as migrations assumem existir.
--
-- Não é uma imitação do Supabase: é só o suficiente para as 40 migrations
-- rodarem e para as políticas de acesso serem exercidas de verdade. Ver
-- scripts/espelho-local.sh.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

-- Os papéis que o PostgREST assume conforme o token da requisição.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF;
END $$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

-- Só as colunas que o app e as migrations tocam.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  encrypted_password text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmation_token text NOT NULL DEFAULT '',
  recovery_token text NOT NULL DEFAULT '',
  email_change text NOT NULL DEFAULT '',
  email_change_token_new text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- É assim que o Supabase expõe o usuário do token. Os testes logam como um
-- usuário fazendo SET request.jwt.claim.sub - rodar como dono do banco
-- ignoraria RLS e daria um "tudo certo" falso.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

GRANT USAGE ON SCHEMA auth, storage, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;

-- Os materiais do aluno ficam num bucket; as migrations criam o bucket e as
-- políticas de acesso aos arquivos.
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(_name text)
RETURNS text[] LANGUAGE sql IMMUTABLE
AS $$ SELECT string_to_array(_name, '/') $$;

GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;

-- Backup manual de setembro, feito à mão no painel e não por migration. Existe
-- aqui só porque a migration 20260913165748 liga RLS nele e o replay pararia
-- sem a tabela. Ver "Achados à parte" em docs/proximos-passos.md: a tabela
-- guarda dados reais de alunos e ainda não foi decidido se fica.
CREATE TABLE IF NOT EXISTS public.lessons_payment_status_backup_20260912 (
  id uuid,
  payment_status text
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
