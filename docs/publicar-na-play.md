# Publicar o Aulas na Google Play

O repositório já monta o arquivo que a loja aceita. O que falta é feito por você,
uma vez só. Depois disso, cada nova versão é um clique.

## 1. Gerar a chave de envio (uma vez, no seu computador)

A Play exige que todo envio venha assinado com a mesma chave. Ela não pode ser
perdida nem entrar no repositório. Com o Java instalado, rode:

```bash
keytool -genkeypair -v -keystore upload.keystore -alias aulas \
  -keyalg RSA -keysize 2048 -validity 10000
```

Guarde o arquivo `upload.keystore` e a senha num lugar seguro, fora do projeto.
Se perder, dá para pedir uma troca de chave ao suporte da Play, mas é chato.

## 2. Guardar a chave nos segredos do GitHub

Transforme o arquivo em texto:

```bash
base64 -w 0 upload.keystore    # no Mac: base64 -i upload.keystore
```

Em Settings, Secrets and variables, Actions, crie:

| Segredo | Conteúdo |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | o texto gerado acima |
| `ANDROID_KEYSTORE_PASSWORD` | a senha do keystore |
| `ANDROID_KEY_ALIAS` | `aulas` |
| `ANDROID_KEY_PASSWORD` | a senha da chave (a mesma, se você repetiu) |

## 3. Gerar o arquivo da loja

Em Actions, "Build Android release (Play)", Run workflow, informe o nome da
versão (ex: `1.0.0`). Ao terminar, baixe o artefato `aulas-play-...`: dentro dele
está o `app-release.aab`, que é o que a Play recebe.

O número interno da versão é o número da execução do workflow, então ele sempre
sobe sozinho e a loja nunca recusa por versão repetida.

## 4. Criar o app no Play Console

- Nome: Portal de Aulas. Pacote: `com.aulasmat.app` (não dá para mudar depois).
- Política de privacidade: `https://SEU-DOMINIO/privacidade`. A página já existe
  no app, mas **preencha o e-mail de contato** em `src/pages/PrivacyPolicy.tsx`
  antes de apontar a loja para ela.
- Formulário de segurança de dados: declare nome, endereço, e-mail e dados
  financeiros; finalidade de funcionamento do app; sem publicidade; dados
  trafegam criptografados; o usuário pode pedir exclusão.
- Público-alvo: adultos. O aluno menor entra com acesso criado pelo responsável.
- Precisa de ícone 512x512, imagem de capa 1024x500 e pelo menos duas capturas
  de tela do celular.

## 5. Escolher a faixa

- **Teste interno**: até 100 pessoas por e-mail, disponível em minutos, sem a
  espera de teste fechado. É o caminho recomendado para as famílias atendidas.
- **Produção**: revisão completa da Google. Contas pessoais criadas depois de
  novembro de 2023 precisam antes de um teste fechado com 12 pessoas por 14 dias.

## Observação sobre atualizações

A build da loja não mostra o aviso de atualização do app: quem instala pela Play
recebe a nova versão pela própria loja. O APK direto, que continua sendo gerado a
cada push, segue com o aviso normalmente.

## Envio automático (desde 25/09)

O workflow **Build Android release (Play)** agora gera o aab **e envia direto
para a Play**, com as notas de `android/whatsnew/whatsnew-pt-BR`, e manda para
a revisão da Google (status `completed`). Nada de baixar e subir à mão.

- Rodar: GitHub → Actions → Build Android release (Play) → Run workflow →
  versão (ex.: 1.16.0) e trilha (`production` por padrão; `internal` para
  teste interno; `none` só gera o aab).
- Sem o segredo `PLAY_SERVICE_ACCOUNT_JSON`, o envio é pulado e o aab fica como
  artefato, como antes.

### Criar a chave (uma vez só)

1. **Google Cloud** (console.cloud.google.com), com a mesma conta Google do
   Play Console:
   1. No topo, escolha ou crie um projeto (ex.: "Cronys Play").
   2. Menu → **APIs e serviços → Biblioteca** → procure **Google Play Android
      Developer API** → **Ativar**.
   3. Menu → **IAM e administrador → Contas de serviço → Criar conta de
      serviço**. Nome: `github-play`. Pode pular as etapas de papel/acesso →
      **Concluir**.
   4. Clique na conta criada → aba **Chaves → Adicionar chave → Criar nova
      chave → JSON → Criar**. Baixa um arquivo `.json` (guarde, é a chave).
   5. Copie o e-mail da conta de serviço (termina em
      `@...iam.gserviceaccount.com`).
2. **Play Console** (play.google.com/console):
   1. Menu lateral da **conta** (fora do app) → **Usuários e permissões →
      Convidar novos usuários**.
   2. E-mail: o da conta de serviço.
   3. Aba **Permissões do app → Adicionar app → Cronys** → marque:
      **Liberar para produção, excluir dispositivos e usar a assinatura de
      apps do Google Play**, **Liberar apps para faixas de teste** e
      **Gerenciar faixas de teste e editar listas de testadores**.
   4. **Convidar usuário** → confirmar.
3. **GitHub** (github.com/tpeleias/aulasmat):
   1. **Settings → Secrets and variables → Actions → New repository secret**.
   2. Nome: `PLAY_SERVICE_ACCOUNT_JSON`. Valor: abra o `.json` baixado no Bloco
      de Notas, copie **tudo** e cole.
   3. **Add secret**. Depois pode apagar o `.json` do computador.

A permissão nova pode levar algumas horas para valer na Google. Se o primeiro
envio falhar com "The caller does not have permission", espere e rode de novo.
