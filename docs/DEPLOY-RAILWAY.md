# Deploy do backend no Railway (homologação)

> Não é entregável do Marco 1 — é conveniência para o cliente testar o APK sozinho.

O build falha se o Railway tentar buildar a **raiz** do repo (monorepo, sem `package.json`
na raiz). É preciso apontar o serviço para `apps/api`.

## Ajustes no serviço `fisko` (Dashboard Railway)

1. **Settings → Root Directory = `apps/api`** ← isto corrige o "build failed".
   (Com isso o Railway lê `apps/api/railway.json`: build Nixpacks + start
   `prisma migrate deploy && node dist/index.js`.)
2. **Adicionar Postgres**: no canvas do projeto → **New → Database → Add PostgreSQL**.
3. **Variables** (aba Variables do serviço `fisko`):
   - `DATABASE_URL` → **Add Reference** → Postgres → `DATABASE_URL`
     (ou cole `${{Postgres.DATABASE_URL}}`)
   - `JWT_ACCESS_SECRET` → (segredo forte, 32+ chars)
   - `JWT_REFRESH_SECRET` → (outro segredo forte)
   - `JWT_ACCESS_TTL` = `15m`
   - `JWT_REFRESH_TTL` = `30d`
   - `GOOGLE_CLIENT_ID` = `686268310274-tet8th5uu2qdmav1afekd8a3csojtkgg.apps.googleusercontent.com`
   - `NODE_ENV` = `production`
   - `APP_URL` = (a URL pública, depois de gerar o domínio — opcional)
4. **Settings → Networking → Generate Domain** → gera a URL pública
   (ex.: `https://fisko-production.up.railway.app`).
5. O Railway redeploya sozinho a cada mudança/push. Fica verde quando
   `/api/v1/health` responde 200.

## Depois

- **Me envie a URL pública.** Eu rebuildo o APK apontando para `API_BASE_URL=<URL>/api/v1`
  (com o Google) e te entrego o APK pronto pro cliente.
- **Google login** continua funcionando sem mexer em nada (o backend valida o `idToken`
  pelo mesmo Web Client ID, independente de onde está hospedado).

## Observações (plano grátis)
- O serviço pode hibernar quando ocioso; o 1º request acorda (alguns segundos).
- Postgres de teste tem limites — para produção, plano pago / infra do contratante.
