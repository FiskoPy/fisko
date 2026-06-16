# ESCOPO.md — Projeto Fisko

> **O que é este arquivo:** instruções persistentes de escopo do projeto neste repositório.
> **Fase ativa:** **MARCO 2 — Núcleo funcional** (Marco 1 entregue/aceito). Em execução faseada:
> 2A SIFEN+faturas → 2B dashboard/relatórios → 2C e-mail → 2D OCR → 2E IA → 2F Pagopar → 2G WhatsApp.
> Leia a seção **"REGRA DE ESCOPO / FASEAMENTO"** antes de qualquer coisa.

---

## ⚠️ REGRA DE ESCOPO / FASEAMENTO (ler primeiro)

O projeto é entregue em 3 marcos pagos. **Só implemente o que está na seção `MARCO 1 (ATIVO)`.**

- **NÃO** inicie, esboce ou "adiante" tarefas dos Marcos 2 ou 3, nem o programa de indicação de contadores.
- É permitido (e desejável) **deixar a arquitetura preparada** para as fases futuras (pastas placeholder, interfaces), mas **sem implementar a lógica** delas.
- Se uma tarefa pedida parecer pertencer a um marco travado, **pare e pergunte** antes de prosseguir.
- A liberação de cada marco acontece **atualizando este arquivo** (mudando a "Fase ativa"). Até lá, o conteúdo em `ROADMAP TRAVADO` é apenas referência.

---

## 1. Produto

**Fisko** — app mobile de gestão fiscal para contribuintes paraguaios com RUC ativo. Diferencial: captura automática de faturas eletrônicas (XML DTE do SIFEN) direto do e-mail do usuário, OCR para faturas físicas, IA fiscal e controle de IVA/IRP.

- **Público:** Paraguai. **Idioma da UI: espanhol (es-PY).** Código e comentários em inglês.
- **Moeda de cobrança no app:** Guaraníes (Gs), via Pagopar (Marco 2).
- **Nome do app:** Fisko · **applicationId (Android):** `com.fisko.app` · **bundleId (iOS):** `com.fisko.app` · **locale padrão:** `es`.

## 2. Stack e arquitetura

**Mobile — Flutter (Dart 3)**
- Estado: `flutter_riverpod` (+ `riverpod_annotation`)
- Navegação: `go_router` (com guarda de autenticação)
- HTTP: `dio` (com interceptors de token/refresh)
- Tokens: `flutter_secure_storage`
- Modelos: `freezed` + `json_serializable` (via `build_runner`)
- Google: `google_sign_in`
- i18n: `flutter_localizations` + ARB (locale padrão `es`)
- Arquitetura **feature-first** (ver seção 8)

**Backend — Node.js (LTS) + TypeScript**
- Framework: `express`
- ORM: `prisma` + PostgreSQL 16
- Validação: `zod`
- Auth: `jsonwebtoken` (access + refresh), hash de senha com `argon2`
- E-mail: `nodemailer` (dev: Ethereal/Mailtrap)
- Google: `google-auth-library` (verificação de idToken)
- Segurança: `helmet`, `cors`, `express-rate-limit`
- Logs: `pino`

## 3. Estrutura do repositório (monorepo)

```
fisko/
├── ESCOPO.md
├── README.md
├── .gitignore
├── apps/
│   ├── api/        # backend Node + TS + Prisma
│   └── mobile/     # app Flutter
└── docs/           # specs detalhadas das fases futuras (quando liberadas)
```

GitHub: **o CONTRATANTE é owner do repositório desde o dia 1**; o desenvolvedor entra como colaborador.

## 4. Convenções

- TypeScript em **strict mode**. ESLint + Prettier no `api`. `flutter_lints` no `mobile`.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`...). Branches: `feat/*`, `fix/*`; PRs para `main`.
- Instruções específicas e verificáveis. Indentação 2 espaços (TS) / padrão `dart format`.
- **Nunca** commitar segredos. Sempre manter `.env.example` atualizado; `.env` no `.gitignore`.
- Toda rota da API sob prefixo `/api/v1`. Respostas de erro padronizadas: `{ error: { code, message, details? } }`.

## 5. Setup e comandos

**API** (`apps/api`)
```bash
npm install
cp .env.example .env          # preencher variáveis
npx prisma migrate dev        # cria/atualiza schema
npm run dev                   # inicia em modo watch
npm run lint && npm run test
```

**Mobile** (`apps/mobile`)
```bash
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter run                   # device/emulador
flutter build apk --release   # Android
flutter build ios --release   # iOS (assinatura no Xcode)
```

## 6. Variáveis de ambiente (API — `.env.example`)

```
PORT=3000
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://user:pass@localhost:5432/fisko
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
GOOGLE_CLIENT_ID=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Fisko <no-reply@fisko.app>"
```
Mobile: `API_BASE_URL` e `GOOGLE_OAUTH_CLIENT_ID` via `--dart-define` ou `.env`.

## 6.1. Dependências externas no Marco 1 (cliente × dev) — **não bloquear o início**

Para começar imediatamente, no Marco 1 usar setup de desenvolvimento e migrar para as contas do CONTRATANTE antes da produção:
- **E-mail (recuperação de senha):** SMTP de teste (Ethereal/Mailtrap) em homologação. Provedor de produção fica para depois, no nome do CONTRATANTE.
- **Google OAuth (login):** projeto Google Cloud de **dev** com OAuth Client IDs (Android/iOS/Web). Migrar para projeto no nome do CONTRATANTE antes da publicação.
- **GitHub:** repositório com **owner = CONTRATANTE**, dev como colaborador (único item que depende do cliente para o dia 1).
- **RUC de teste:** validar o dДVEmi com RUCs reais fornecidos pelo CONTRATANTE.
- **NÃO** aguardar Apple Developer, Google Play ou APIs pagas — são dos Marcos 2/3.

---

# MARCO 1 (ATIVO) — Setup + Autenticação + Estrutura base

Objetivo: app instalável nas duas plataformas, com autenticação completa, recuperação de senha funcionando e navegação base esqueletada.

## 7. Modelo de dados (Prisma — Fase 1)

```prisma
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String?            // null se cadastro só via Google
  name          String
  ruc           String?            // RUC paraguaio (sem dígito verificador)
  rucDv         Int?               // dígito verificador (dDVEmi)
  googleId      String?  @unique
  emailVerified Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  resetTokens   PasswordResetToken[]
}

model PasswordResetToken {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String              // hash do token (nunca o token em claro)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
}
```

## 8. API — endpoints de autenticação (Fase 1)

Todos sob `/api/v1`. Validar payloads com Zod. Senha: hash com argon2. Tokens: access (curto) + refresh (longo).

| Método | Rota | Descrição |
|---|---|---|
| GET  | `/health` | Healthcheck |
| POST | `/auth/register` | `{ name, email, password, ruc? }` → valida dDVEmi do RUC se enviado; cria usuário; retorna tokens |
| POST | `/auth/login` | `{ email, password }` → tokens |
| POST | `/auth/google` | `{ idToken }` → verifica com Google; upsert do usuário; tokens |
| POST | `/auth/refresh` | `{ refreshToken }` → novo par de tokens |
| POST | `/auth/forgot-password` | `{ email }` → gera token e envia e-mail (resposta sempre 200, sem revelar existência) |
| POST | `/auth/reset-password` | `{ token, newPassword }` → valida token (não expirado/não usado) e troca a senha |
| GET  | `/auth/me` | (protegido) dados do usuário logado |
| POST | `/auth/logout` | invalida o refresh token |

## 9. App Flutter — estrutura (Fase 1)

```
lib/
├── main.dart
├── app.dart
├── core/
│   ├── config/        # env, constantes
│   ├── router/        # go_router + guarda de auth
│   ├── network/       # dio_client + interceptors
│   ├── storage/       # token_storage (secure)
│   ├── theme/         # app_theme
│   └── errors/        # failures/exceptions
├── features/
│   ├── auth/
│   │   ├── data/          # auth_api, auth_repository, models (freezed)
│   │   ├── application/    # auth_controller (Riverpod), auth_state
│   │   ├── domain/         # validators/ruc_validator.dart
│   │   └── presentation/   # login/register/forgot/reset pages + widgets
│   ├── shell/             # app_shell (Scaffold + bottom nav)
│   ├── dashboard/         # placeholder (NÃO implementar lógica)
│   ├── captura/           # placeholder
│   ├── relatorios/        # placeholder
│   └── perfil/            # placeholder
├── l10n/                  # ARB es-PY
└── shared/widgets/
```

Navegação (`go_router`): rotas públicas `/login`, `/register`, `/forgot`, `/reset`; rota com shell e abas `/dashboard`, `/captura`, `/relatorios`, `/perfil`. Guarda redireciona para `/login` sem token válido. As 4 abas são apenas **esqueleto** (título + placeholder).

## 10. Checklist do Marco 1 (ordem sugerida)

1. Monorepo + Git; repositório no GitHub com **owner = CONTRATANTE**, dev como colaborador.
2. `api`: esqueleto Express + TS + Prisma + Postgres, `/health`, config, error handler, logging.
3. Migrations: `User`, `PasswordResetToken`.
4. Auth: register (com validação dДVEmi do RUC), login (argon2 + JWT), refresh, me, logout.
5. Google OAuth: verificar idToken, upsert do usuário, emitir tokens.
6. Recuperação de senha: forgot (gera token + envia e-mail) e reset — **ponta a ponta em homologação**.
7. `mobile`: esqueleto feature-first, theme, router, dio client, secure storage.
8. Telas de auth (login/register/forgot/reset) com validações e tratamento de erros, integradas à API.
9. Botão Google sign-in → `/auth/google`.
10. Navegação base com as 4 abas esqueletadas.
11. Builds de teste: **APK Android** + **build iOS/TestFlight**.
12. `README.md` + `.env.example` + instruções de execução.

## 11. Critérios de aceitação do Marco 1 (Definition of Done)

- [ ] (a) Projeto Flutter rodando em **iOS e Android**, arquitetura feature-first, repo GitHub com CONTRATANTE como owner.
- [ ] (b) Login e cadastro por **e-mail/senha** com validações e tratamento de erros + **Google OAuth** em ambiente de teste.
- [ ] (c) **Recuperação de senha por e-mail** funcionando de ponta a ponta em homologação.
- [ ] (d) **Navegação base** com as telas principais esqueletadas.
- [ ] (e) **Build de teste** (APK Android + TestFlight/build iOS) entregue para validação.

## 12. Notas Paraguai (relevantes ao Marco 1)

**RUC — dígito verificador (dDVEmi).** Implementar em `ruc_validator` (mobile) e validar também no backend. Algoritmo de referência (módulo 11, base 11) — **validar contra RUCs reais e a especificação oficial da DNIT antes de produção:**

```ts
// Referência — verificar com dados reais antes de confiar em produção.
export function calcRucDv(ruc: string, base = 11): number {
  const digits = ruc.replace(/\D/g, "");
  let total = 0;
  let k = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    total += parseInt(digits[i], 10) * k;
    k = k < base ? k + 1 : 2;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}
```

- Captura de DTE por e-mail e parser SIFEN são **Marco 2** — não implementar agora.
- Política de privacidade (es, Lei 6.534/2020) é **Marco 3**.

---

# ROADMAP TRAVADO — NÃO IMPLEMENTAR (referência)

> Liberar apenas mudando a "Fase ativa" no topo deste arquivo, após pagamento do respectivo marco.

**Marco 2 — Núcleo funcional (TRAVADO):**
- Captura automática de XML DTE via OAuth Gmail/Outlook.
- Parser SIFEN nível produção: validação do CDC (44 dígitos); tipo de documento (Factura, Autofactura, Nota de Crédito/Débito/Remisión); extração de itens (produto, qtd, preço unitário, IVA 5%/10%); CDC da fatura original em Notas de Crédito; dígito verificador do RUC.
- OCR de faturas físicas (Google Vision) + fluxo de erro.
- Dashboard fiscal (gráficos, categorias, histórico).
- IA Fiscal Inteligente **v1 (regras e thresholds)**: informe de gastos a cada 10 dias, alerta de IVA acumulado/vencimento, sugestão de captura, mensagens de incentivo. (Estimativa de IVA via IA — GPT-4o-mini.)
- Pagopar: assinatura por **faixa de volume de faturas** (Gratuito até 5; Básico até 50; Pro até 300; Empresarial ilimitado), cobrança em Guaraníes, webhook de confirmação e controle de acesso por assinatura ativa.
- Relatório fiscal **PDF e Excel** com IVA discriminado (5%/10%) e estimativa de **IRP**, envio via WhatsApp.

**Marco 3 — Publicação (TRAVADO):**
- Política de privacidade em espanhol (Lei 6.534/2020 do Paraguai).
- Testes em dispositivos reais (2 iOS + 2 Android).
- Publicação na App Store e Google Play.
- 2 semanas de suporte pós-lançamento.

**Fora de escopo (Fase 2 futura, orçada à parte):**
- Programa de indicação/comissão para contadores (link de indicação, atribuição de clientes, painel de acompanhamento).

---

## Como usar este documento

- Mantenha este arquivo (`ESCOPO.md`) na raiz do repositório como referência de escopo.
- Mantenha segredos em `.env` (no `.gitignore`); use `.env.example` para a estrutura.
- Preferências pessoais (que não vão pro cliente) podem ir em `ESCOPO.local.md` (também no `.gitignore`).
- Ao concluir e receber o Marco 1, **atualize a "Fase ativa"** no topo para o Marco 2 e mova o detalhamento dele para `docs/` se preferir manter este arquivo enxuto.
