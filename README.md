# Fisko

App móvel de gestão fiscal para contribuintes paraguaios com RUC ativo.
Monorepo com backend Node/TypeScript e app Flutter.

> **Fase ativa:** Marco 1 — Setup + Autenticação + Estrutura base.
> Ver [`CLAUDE.md`](./CLAUDE.md) para a especificação e regras de escopo.

## Estrutura

```
fisko/
├── apps/
│   ├── api/        # backend Node + TS + Express + Prisma
│   └── mobile/     # app Flutter (feature-first)
├── docs/           # specs das fases futuras (quando liberadas)
├── docker-compose.yml   # Postgres 16 para desenvolvimento
└── CLAUDE.md
```

## Pré-requisitos

- Node.js LTS (testado com v22) + npm
- Docker + Docker Compose (para o Postgres de dev)
- Flutter SDK (Dart 3) — apenas para o app mobile

## Backend (`apps/api`)

```bash
# 1. Subir o Postgres de desenvolvimento (na raiz do repo)
docker compose up -d

# 2. Instalar dependências e configurar env
cd apps/api
npm install
cp .env.example .env          # preencher os segredos JWT (Google é opcional em dev)

# 3. Criar/atualizar o schema
npm run prisma:migrate

# 4. Rodar
npm run dev                   # modo watch em http://localhost:3000
npm run test                  # testes (vitest)
npm run lint                  # eslint
```

Healthcheck: `GET http://localhost:3000/api/v1/health`.

Todas as rotas da API ficam sob o prefixo `/api/v1`. Em dev, a recuperação de senha
usa uma conta de teste **Ethereal** gerada automaticamente — o link de preview do
e-mail é logado no console.

## Mobile (`apps/mobile`)

```bash
cd apps/mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 \
  --dart-define=GOOGLE_OAUTH_CLIENT_ID=<seu-client-id>
```

Builds de release:

```bash
flutter build apk --release   # Android
flutter build ios --release   # iOS (assinatura no Xcode)
```

## Dependências externas (a configurar pelo CONTRATANTE antes de produção)

- **GitHub:** repositório com owner = CONTRATANTE; dev como colaborador.
- **Google OAuth:** OAuth Client IDs (Android/iOS/Web) num projeto Google Cloud.
- **SMTP de produção:** substituir o Ethereal por um provedor real.
- **Apple Developer / Google Play:** Marcos 2/3.
