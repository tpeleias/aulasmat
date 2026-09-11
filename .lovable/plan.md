# Plano: Integrações com agentes (MCP)

## O que será criado

- Um servidor MCP protegido por login para o **Site - Aulas**.
- Ferramentas para consultar alunos, professores, aulas, bloqueios e cobranças.
- Ferramentas administrativas para criar/editar aulas, registrar pagamentos e gerenciar bloqueios, respeitando as permissões já existentes.
- Uma tela segura de autorização para conectar ChatGPT, Claude, Lovable e outros clientes compatíveis.

## Arquivos e áreas afetadas

- `src/lib/mcp/tools/*`: uma ferramenta MCP por arquivo.
- `src/lib/mcp/index.ts`: catálogo e proteção OAuth do servidor.
- `src/lib/mcp/supabase.ts`: acesso ao banco usando a identidade conectada.
- `src/pages/OAuthConsent.tsx`: aprovação ou recusa da conexão.
- `src/App.tsx` e `src/pages/Auth.tsx`: rota de autorização e retorno correto após login.
- `vite.config.ts` e dependências: geração automática da função MCP.
- `supabase/functions/mcp/index.ts`: arquivo gerado e publicado automaticamente.

## Segurança e validação

- Cada chamada será autenticada; nenhuma ferramenta usará acesso administrativo oculto.
- As regras de acesso do banco continuarão valendo para o usuário conectado.
- Ações destrutivas serão identificadas para que o agente solicite confirmação.
- O catálogo MCP será validado, a função será publicada e o endpoint será testado.