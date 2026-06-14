# Deploy do backend no Render (homologação)

> Não é entregável do Marco 1 — é conveniência para o cliente testar o APK sozinho.

Usa o **Blueprint** `render.yaml` (na raiz) que builda pelo **Dockerfile** validado
(`apps/api/Dockerfile`, contexto `apps/api`) — sem os problemas de monorepo do Railway.

## Passo a passo (Dashboard Render)

1. Crie conta em **https://render.com** (pode ser "Sign in with GitHub").
2. **New +** → **Blueprint**.
3. Conecte/autorize o repositório **`FiskoPy/fisko`** (Render pede acesso ao GitHub uma vez;
   para repo privado, autorize a org **FiskoPy**).
4. O Render lê o `render.yaml` e mostra **fisko-api** (Docker) + **fisko-db** (Postgres).
   Clique **Apply**.
5. Aguarde o build do Docker + deploy. O Postgres é criado e as migrations rodam no start
   (`prisma migrate deploy`, dentro do CMD do Dockerfile). Fica verde quando
   `/api/v1/health` responde 200.
6. Copie a **URL pública** (ex.: `https://fisko-api.onrender.com`).
7. (Opcional) Em *fisko-api → Environment*, defina **APP_URL** = essa URL.

## Depois
- **Me envie a URL.** Rebuildo o APK apontando para `API_BASE_URL=<URL>/api/v1` (com Google).
- O **login Google** segue funcionando sem mudar nada (backend valida o idToken pelo mesmo
  Web Client ID, independente do host).

## Observações (plano free)
- O web hiberna após ~15 min ocioso; o 1º request acorda (~30–60s).
- Postgres free expira em ~30 dias — para produção, plano pago / infra do contratante.

## Alternativa (eu faço via API)
Se preferir, crie uma **API Key** no Render (*Account Settings → API Keys*) e me envie:
com ela eu consigo orquestrar/disparar via API. Mesmo assim, conectar o GitHub ao Render
é uma vez no painel.
