# Consulta de Canhotos

Web app (mobile-first) para digitalizar canhotos de NF por foto, com leitura por IA, e consultá-los depois.
Stack: Vite + React + TypeScript · Firebase Auth · Cloud Firestore · Firebase AI Logic (Gemini, OCR) · Firebase Hosting. Roda no plano gratuito (Spark).

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
│   │   └── leituraCanhotoService.ts  # leitura por IA (Firebase AI Logic / Gemini) + validação
│   └── lib/                          # firebase, imagem (compressão), datas, texto
├── scripts/seed-usuarios.mjs         # cria usuários + perfis
├── firestore.rules · firestore.indexes.json · firebase.json
└── .env.example
```

## 1. Configurar o Firebase (uma vez)

1. [Console Firebase](https://console.firebase.google.com) → criar projeto.
2. **Authentication** → Método de login → ative **E-mail/senha**.
3. **Firestore Database** → criar banco (modo produção; região `southamerica-east1`).
4. **Configurações do projeto → Seus apps → Web** → registre o app e copie a config.
5. No terminal:
   ```powershell
   npm install
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

## 3. IA (OCR) — Firebase AI Logic

- Usa **Gemini** (`gemini-2.5-flash`, constante `MODELO` em `src/services/leituraCanhotoService.ts`) pelo SDK `firebase/ai`, sem Cloud Functions e sem Blaze. A chave do Gemini fica no Firebase, nunca no bundle.
- Habilite uma vez: Console → **Build → AI Logic → Começar** → escolha **Gemini Developer API** (cria a chave e habilita as APIs).
- A resposta é JSON com schema; o que for ilegível volta `null`. O front valida (nº da NF só dígitos, data real e não futura) e `obrigatoriosFaltando` lista o que falhou.
- Como a chamada parte do navegador, ative **App Check** (Console → App Check, reCAPTCHA v3) e depois "Aplicar" para AI Logic, para que só o seu site consiga usar a cota. Defina também um limite de gasto/cota no Google AI Studio.

## 4. Rodar localmente

Com emuladores (não usa produção nem gasta dados reais):
```powershell
# .env.local               ->  VITE_USE_EMULATORS=true  (e um projeto qualquer em .firebaserc, ex. demo-canhotos)
npm run emulators           # terminal 1 (Auth, Firestore). A IA continua chamando o Gemini real
npm run seed:emulador       # terminal 2 (cria usuários no emulador)
npm run dev                 # terminal 3 -> http://localhost:5173
```
Para testar a câmera no celular, o navegador exige HTTPS (use o deploy ou um túnel HTTPS); na galeria funciona em HTTP local.

## 5. Deploy

```powershell
firebase deploy --only firestore        # rules + índices
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
- A leitura por IA roda no navegador: sem App Check, qualquer um com a config web poderia gastar a cota do Gemini. Ative App Check e limite a cota.

## Testes das rules

```powershell
npm run test:rules   # sobe o emulador do Firestore e roda tests/rules.test.mjs (precisa de Java)
```
