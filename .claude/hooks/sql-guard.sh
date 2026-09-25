#!/bin/bash
# Decide se um SQL enviado ao Supabase (execute_sql ou apply_migration) precisa
# da sua confirmação.
#
# Desde 25/09 (pedido do Thiago) o SQL que escreve passa direto: insert,
# update, alter, create, migrations. Só continua perguntando o que apaga dados
# em massa e não tem volta:
#   - drop table / drop schema / drop database
#   - truncate
#   - delete ou update SEM where (a tabela inteira)
# drop de função, gatilho, política ou restrição (comum em migration) passa.
#
# Se algo der errado aqui (jq falhar, JSON estranho), o script não decide nada e
# o Claude Code volta a pedir permissão como antes. O padrão é sempre perguntar.
#
# Para testar à mão:
#   echo '{"tool_input":{"query":"select 1"}}' | .claude/hooks/sql-guard.sh
#   bash .claude/hooks/sql-guard.test.sh

set -uo pipefail

# Passadas por --arg, ou seja, literais: aqui vai a expressão como o motor de
# regex a lê, sem escape extra de shell nem de JSON. Escrever '\\b' aqui faria
# procurar uma barra invertida seguida de "b", e nada casaria - o script
# liberaria tudo em silêncio. Já aconteceu; por isso os testes existem.
DESTROI='\b(drop\s+(table|schema|database)|truncate)\b'
EM_MASSA='^\s*(delete\s+from|update)\b'
FILTRO='\bwhere\b'

jq -c --arg destroi "$DESTROI" --arg massa "$EM_MASSA" --arg filtro "$FILTRO" '
  def perguntar(motivo): {hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: motivo}};
  (.tool_input.query // "") as $q
  | ($q | ascii_downcase) as $sql
  # Sem consulta nenhuma é chamada malformada: perguntar, não adivinhar.
  | if ($q | gsub("\\s";"") | length) == 0 then perguntar("Chamada sem consulta SQL.")
    elif ($sql | test($destroi)) then perguntar("Este SQL apaga uma tabela inteira no banco de produção.")
    elif ([$sql | split(";")[] | select(test($massa) and (test($filtro) | not))] | length) > 0
      then perguntar("DELETE ou UPDATE sem WHERE: mexe na tabela inteira, em produção.")
    else {hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: "SQL liberado (sem apagar tabela nem mexer na tabela inteira)."}}
    end'
