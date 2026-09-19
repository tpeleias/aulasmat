#!/bin/bash
# Testa sql-guard.sh. Rode com: bash .claude/hooks/sql-guard.test.sh
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
echo "== escrita: deve perguntar =="
testa ask "delete from lessons where id = 1"
testa ask "DELETE FROM public.lessons"
testa ask "update settings set allow_student_booking = false"
testa ask "insert into accounts (name) values ('x')"
testa ask "drop table students"
testa ask "alter table lessons add column foo text"
testa ask "truncate audit_log"
testa ask "grant all on lessons to anon"
testa ask "revoke all on lessons from anon"
testa ask "create index on lessons (start_at)"
testa ask "BEGIN; delete from lessons; ROLLBACK;"
testa ask "select 1; delete from lessons"

echo ""
echo "== duvidoso: perguntar, por precaução =="
testa ask "select * from lessons -- delete isso depois"
testa ask "select * from lessons for update"
testa ask ""
testa ask "   "

echo ""
if [ "$falhas" -eq 0 ]; then echo "TODOS OS CASOS PASSARAM"; else echo "$falhas CASO(S) FALHARAM"; exit 1; fi
