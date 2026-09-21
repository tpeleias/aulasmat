#!/usr/bin/env bash
# Levanta um Postgres local que reproduz o banco de produção e roda os testes.
#
# Por que existe: as regras de acesso do app estão no Postgres, não na tela.
# Testar mudança de banco direto na produção é o caminho para vazar dado de
# criança real. Aqui as 40 migrations são replayadas sobre stubs do que o
# Supabase entrega pronto, e os testes rodam como o papel `authenticated`, com
# session_user `authenticator` - exatamente como o PostgREST chama. Rodar como
# dono do banco ignoraria RLS e daria um "tudo certo" falso.
#
#   ./scripts/espelho-local.sh          # levanta, replaya e testa
#   ./scripts/espelho-local.sh --keep   # deixa o servidor no ar ao terminar
#
# Precisa do Postgres 16 instalado (apt install postgresql-16) e de um usuário
# não-root para ser dono do cluster, porque o initdb se recusa a rodar como root.

set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGPORT=${PGPORT:-5433}
PGOWNER=${PGOWNER:-pg}
PGDATA_DIR=${PGDATA_DIR:-/home/$PGOWNER/data}
SOCKET=/tmp

export PGHOST=$SOCKET PGPORT PGUSER=postgres

comoDono() { if [ "$(id -u)" = 0 ]; then su "$PGOWNER" -c "$1"; else bash -c "$1"; fi; }

# --- pg_cron não existe fora do Supabase; uma extensão de mentira com o mesmo
# --- nome deixa o replay das migrations continuar fiel ao arquivo.
EXTDIR=$("$PGBIN/pg_config" --sharedir)/extension
if [ ! -f "$EXTDIR/pg_cron.control" ]; then
  cat > "$EXTDIR/pg_cron.control" <<'CTRL'
comment = 'stub do pg_cron para o espelho local'
default_version = '1.0'
relocatable = false
schema = 'pg_catalog'
CTRL
  cat > "$EXTDIR/pg_cron--1.0.sql" <<'EXT'
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  jobname text UNIQUE
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid
$$;
CREATE FUNCTION cron.unschedule(job_name text)
RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobname = job_name RETURNING true
$$;
EXT
fi

if ! "$PGBIN/pg_isready" -q 2>/dev/null; then
  echo "==> levantando o Postgres em $PGDATA_DIR (porta $PGPORT)"
  id "$PGOWNER" >/dev/null 2>&1 || useradd -m "$PGOWNER"
  rm -rf "$PGDATA_DIR"; mkdir -p "$PGDATA_DIR"; chown -R "$PGOWNER" "$(dirname "$PGDATA_DIR")"
  comoDono "$PGBIN/initdb -D $PGDATA_DIR -U postgres --auth=trust -E UTF8" >/dev/null
  comoDono "$PGBIN/pg_ctl -D $PGDATA_DIR -o '-p $PGPORT -k $SOCKET' -l /tmp/pg.log start" >/dev/null
  sleep 2
fi

echo "==> recriando o banco e aplicando os stubs do Supabase"
psql -q -c "DROP DATABASE IF EXISTS espelho;" -c "CREATE DATABASE espelho;" postgres >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d espelho -f scripts/espelho-stubs.sql >/dev/null

echo "==> replayando as migrations"
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d espelho -f "$f" >/dev/null 2>&1 \
    || { echo "FALHOU: $(basename "$f")"; psql -v ON_ERROR_STOP=1 -d espelho -f "$f" 2>&1 | tail -20; exit 1; }
done
echo "    $(ls supabase/migrations/*.sql | wc -l) migrations aplicadas"

echo "==> testes"
psql -q -v ON_ERROR_STOP=1 -d espelho -f scripts/espelho-testes.sql 2>&1 \
  | grep -E "NOTICE:|^---|^===|ERROR" | sed 's/^psql[^ ]* //;s/NOTICE:  //'

if [ "${1:-}" != "--keep" ]; then
  comoDono "$PGBIN/pg_ctl -D $PGDATA_DIR stop" >/dev/null
  echo "==> servidor parado (use --keep para deixá-lo no ar)"
else
  echo "==> servidor no ar: psql -h $SOCKET -p $PGPORT -U postgres espelho"
fi
