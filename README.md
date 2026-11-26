# Consulta de Canhotos

Web app (mobile-first) para digitalizar canhotos de NF por foto, com leitura por IA, e consultá-los depois.
Stack: Vite + React + TypeScript · Firebase Auth · Cloud Firestore · Cloud Functions (OCR).

## Estrutura

```
├── src/
│   ├── main.tsx · App.tsx · styles.css
│   ├── types.ts                      # tipos e rótulos de perfil/campos
│   ├── contexts/AuthContext.tsx      # sessão + perfil (usuarios/{uid})
│   ├── components/                   # ProtectedRoute, Layout, CanhotoDetalhe, Feedback
│   ├── pages/                        # LoginPage, ConsultaPage, DigitalizacaoPage, SemPerfil
│   ├── services/
│   │   ├── canhotosService.ts        # buscas, leitura da imagem, gravação atômica
│   │   └── leituraCanhotoService.ts  # chama a Cloud Function de OCR
│   └── lib/                          # firebase, imagem (compressão), datas, texto
├── functions/src/index.ts            # Cloud Function `lerCanhoto` (chave de IA só aqui)
├── scripts/seed-usuarios.mjs         # cria usuários + perfis
├── firestore.rules · firestore.indexes.json · firebase.json
└── .env.example
```

## 1. Configurar o Firebase (uma vez)

1. [Console Firebase](https://console.firebase.google.com) → criar projeto (plano **Blaze** é obrigatório para Cloud Functions e Secrets).
2. **Authentication** → Método de login → ative **E-mail/senha**.
3. **Firestore Database** → criar banco (modo produção; região `southamerica-east1`).
4. **Configurações do projeto → Seus apps → Web** → registre o app e copie a config.
5. No terminal:
   ```powershell
   npm install
   npm install --prefix functions
   npm install -g firebase-tools
   firebase login
   ```
   Edite `.firebaserc` com o ID do projeto e copie `.env.example` para `.env.local` com os valores da config web.

## 2. Primeiro usuário e perfis

Perfis ficam em `usuarios/{uid}` (`nome`, `perfil`). As rules **proíbem** escrita pelo cliente, então o cadastro é feito por admin:

**Opção A – script de seed (recomendado)**
1. Console → Configurações → *Contas de serviço* → *Gerar nova chave privada* (guarde fora do repo).
2. ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\serviceAccountKey.json"
   $env:GCLOUD_PROJECT="seu-projeto"
   Copy-Item scripts\usuarios.seed.example.json scripts\usuarios.seed.json   # edite e-mails/senhas/perfis
   npm run seed
   ```
   O script é idempotente (reexecutar atualiza nome/perfil).

**Opção B – manual**: Authentication → Adicionar usuário (e-mail/senha) → copie o UID → Firestore → coleção `usuarios` → documento com ID = UID e campos `nome` (string) e `perfil` (`rotas` | `fiscal` | `comercial` | `gestao_rotas`).

Usuário autenticado sem documento em `usuarios` vê a tela "Acesso pendente" e as rules negam qualquer leitura.

## 3. IA (OCR) — modelo e chave

- **Modelo sugerido: Claude Sonnet (visão)**, padrão `claude-sonnet-5-5`. Lê bem texto impresso e manuscrito em fotos de celular, segue instruções de "retorne null se ilegível" (essencial para não inventar dados) e entrega JSON estruturado via *tool use* forçado. Para menor custo/latência teste um modelo Haiku; para casos difíceis, um Opus. Troque sem alterar código: `OCR_MODEL=<id>` em `functions/.env` (ou `functions/.env.<projeto>`).
- A chave fica no **Secret Manager**, nunca no front:
  ```powershell
  firebase functions:secrets:set ANTHROPIC_API_KEY
  ```
- A função exige login, confere no Firestore que o perfil é `rotas`, valida tipo/tamanho da imagem e descarta datas inválidas/futuras. Campos não lidos voltam `null` e `obrigatoriosFaltando` lista o que falhou.

## 4. Rodar localmente

Com emuladores (não usa produção nem gasta dados reais):
```powershell
# functions/.secret.local  ->  ANTHROPIC_API_KEY=sk-ant-...   (a chamada de IA continua real)
# .env.local               ->  VITE_USE_EMULATORS=true  (e um projeto qualquer em .firebaserc, ex. demo-canhotos)
npm run emulators           # terminal 1 (Auth, Firestore, Functions) — compile antes: npm run build --prefix functions
npm run seed:emulador       # terminal 2 (cria usuários no emulador)
npm run dev                 # terminal 3 -> http://localhost:5173
```
Para testar a câmera no celular, o navegador exige HTTPS (use o deploy ou um túnel HTTPS); na galeria funciona em HTTP local.

## 5. Deploy

```powershell
firebase deploy --only firestore        # rules + índices
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase deploy --only functions
npm run build
firebase deploy --only hosting
# ou tudo: npm run deploy
```
Depois do deploy, o índice composto leva alguns minutos para ficar "Ativado" (Console → Firestore → Índices).

## Modelo de dados, buscas e índices

| Busca | Consulta | Índice |
|---|---|---|
| Nota Fiscal | `numeroNota == X` ordenado por `dataAssinatura desc` | **Composto**: `numeroNota ASC, dataAssinatura DESC` (em `firestore.indexes.json`) |
| Cliente | `clienteBusca >= p` e `<= p + \uf8ff` (prefixo) | Campo único (automático) |
| Data | `dataAssinatura` entre 00:00 e 23:59:59.999 do dia | Campo único (automático) |

- `numeroNota` é normalizado (só dígitos, sem zeros à esquerda) ao salvar e ao buscar.
- `dataAssinatura` é gravada ao meio-dia local do dia lido (evita deslocamento por fuso).
- A foto vive em `canhotos_imagens/{mesmo id}` (JPEG base64, largura ≤ 1280 px, qualidade 0.7; rules limitam a 900 mil caracteres). Canhoto e imagem são gravados no mesmo `writeBatch`; as rules exigem que a imagem só exista junto do canhoto.
- Canhotos são imutáveis (sem update/delete). Resultados limitados a 50 por busca.

## Segurança

- Front-end oculta "Digitalizar" e bloqueia a rota para quem não é `rotas`; as **Security Rules** reforçam: só `rotas` cria, todos os perfis válidos leem, `usuarios` é somente leitura do próprio doc.
- Cada checagem de perfil nas rules custa 1 leitura extra do doc `usuarios/{uid}`. Se isso pesar, migre o perfil para *custom claims* (`request.auth.token.perfil`) via Admin SDK.
- A função de OCR não tem limite de uso por usuário; para produção considere App Check e um contador diário por `uid`.

## Testes das rules

```powershell
npm run test:rules   # sobe o emulador do Firestore e roda tests/rules.test.mjs (precisa de Java)
```
