#!/bin/bash
# Decide se um SQL enviado ao Supabase precisa da sua confirmação.
#
# Consulta que só lê passa direto. Qualquer coisa que escreva - insert, update,
# delete, drop, alter, truncate, create, grant, revoke - continua pedindo
# autorização, porque o banco é o de produção, com dados reais de alunos.
#
# A regra é deliberadamente burra e conservadora: procura a palavra em qualquer
# lugar do texto. Um "delete" dentro de um comentário faz o comando pedir
# confirmação à toa. Isso é de propósito - errar para o lado de perguntar custa
# um toque; errar para o outro lado custa dados.
#
# Se algo der errado aqui (jq falhar, JSON estranho), o script não decide nada e
# o Claude Code volta a pedir permissão como antes. O padrão é sempre perguntar.
#
# Para testar à mão:
#   echo '{"tool_input":{"query":"select 1"}}' | .claude/hooks/sql-guard.sh

set -uo pipefail

# Passada por --arg, ou seja, literal: aqui vai a expressão como o motor de
# regex a lê, sem escape extra de shell nem de JSON. Escrever '\\b' aqui faria
# procurar uma barra invertida seguida de "b", e nada casaria - o script
# liberaria tudo em silêncio. Já aconteceu; por isso os testes abaixo existem.
ESCRITA='\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b'

jq -c --arg re "$ESCRITA" '
  # Sem consulta nenhuma é chamada malformada: perguntar, não adivinhar.
  if ((.tool_input.query // "") | gsub("\\s";"") | length) == 0
  then {hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "Chamada sem consulta SQL."}}
  elif ((.tool_input.query // "") | ascii_downcase | test($re))
  then {hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "Este SQL escreve no banco de produção."}}
  else {hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "SQL somente leitura."}}
  end'
