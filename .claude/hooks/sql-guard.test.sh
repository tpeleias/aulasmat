#!/bin/bash
# Testa sql-guard.sh (regra de 25/09: só pergunta o destrutivo). Rode com: bash .claude/hooks/sql-guard.test.sh
#
# Existe porque a primeira versão do guard liberava TODA escrita por um escape
# errado na expressão, e passava despercebido: o script respondia "allow" sem
# erro nenhum. Um guard que falha em silêncio é pior que nenhum guard.

GUARD="$(dirname "$0")/sql-guard.sh"
falhas=0

testa() {
  local esperado="$1" sql="$2"
  local decisao
  decisao=$(jq -nc --arg q "$sql" '{tool_name:"mcp__Supabase__execute_sql",tool_input:{query:$q}}' \
            | bash "$GUARD" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
  if [ "$decisao" = "$esperado" ]; then
    printf 'ok    %-5s  %s\n' "$decisao" "${sql:0:56}"
  else
    printf 'FALHA esperava=%s obteve=%s  %s\n' "$esperado" "${decisao:-<nada>}" "${sql:0:56}"
    falhas=$((falhas+1))
  fi
}

echo "== leitura: deve liberar =="
testa allow "select * from lessons"
testa allow "SELECT count(*) FROM public.students WHERE active"
testa allow "with x as (select 1) select * from x"
testa allow "explain analyze select * from lessons"
testa allow "select column_name from information_schema.columns"
testa allow "select * from lessons where notes like '%remover%'"

echo ""
echo "== escrita comum: libera (desde 25/09) =="
testa allow "delete from lessons where id = 1"
testa allow "update settings set allow_student_booking = false where account_id = 'x'"
testa allow "insert into accounts (name) values ('x')"
testa allow "alter table lessons add column foo text"
testa allow "grant all on lessons to authenticated"
testa allow "create index on lessons (start_at)"
testa allow "DROP TRIGGER IF EXISTS t ON lessons; CREATE TRIGGER t BEFORE INSERT ON lessons FOR EACH ROW EXECUTE FUNCTION f();"
testa allow "drop policy if exists p on lessons"
testa allow "alter table students drop constraint if exists c"
testa allow "select * from lessons -- delete isso depois"
testa allow "select * from lessons for update"

echo ""
echo "== destrutivo: deve perguntar =="
testa ask "drop table students"
testa ask "DROP SCHEMA public CASCADE"
testa ask "truncate audit_log"
testa ask "DELETE FROM public.lessons"
testa ask "update settings set allow_student_booking = false"
testa ask "BEGIN; delete from lessons; ROLLBACK;"
testa ask "select 1; delete from lessons"
testa ask "update a set x = 1 where id = 2; update b set y = 2"

echo ""
echo "== malformado: perguntar =="
testa ask ""
testa ask "   "

echo ""
if [ "$falhas" -eq 0 ]; then echo "TODOS OS CASOS PASSARAM"; else echo "$falhas CASO(S) FALHARAM"; exit 1; fi
