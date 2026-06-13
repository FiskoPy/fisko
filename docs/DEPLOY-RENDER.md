# Deploy do backend no Render (homologação)

> Lembrete: este deploy **não é entregável do Marco 1** — é conveniência para o
> cliente testar o APK sozinho. O Marco 1 já está completo e validado.

O repositório tem um Blueprint (`render.yaml`) que provisiona **backend + Postgres +
variáveis** automaticamente. Passos (a parte de conectar GitHub é interativa, só você faz):

## Passo a passo (Dashboard Render)

1. Crie conta em **https://render.com** (pode ser "Sign in with GitHub").
2. **New +** → **Blueprint**.
3. Conecte/autorize o repositório **`FiskoPy/fisko`** (Render pede acesso ao GitHub uma vez).
4. O Render detecta o `render.yaml` e mostra os recursos: **fisko-api** (web) + **fisko-db** (Postgres).
   Clique **Apply**.
5. Aguarde o build + deploy (~3–5 min). O Postgres é criado e as migrations rodam no start
   (`prisma migrate deploy`). O serviço fica verde quando `/api/v1/health` responde.
6. Copie a **URL pública** do serviço (ex.: `https://fisko-api.onrender.com`).
7. (Opcional) Em *fisko-api → Environment*, defina **APP_URL** = essa URL (melhora o link do
   e-mail de recuperação). Não é obrigatório para testar.

## Depois

- **Me envie a URL** (`https://fisko-api.onrender.com`). Eu **rebuildo o APK** apontando para
  `API_BASE_URL=<URL>/api/v1` (com o Google Client ID) e te entrego o APK pronto para o cliente.
- **Google login continua funcionando** sem mexer em nada: o backend valida o `idToken` pelo
  mesmo Web Client ID, independentemente de onde está hospedado.

## Observações (plano free)

- O web **hiberna após ~15 min** ocioso; o 1º request acorda (~30–60s). Normal para homologação.
- O **Postgres free expira em ~30 dias**. Para algo mais durável, subir para plano pago ou
  migrar para a conta/infra do contratante na fase de produção.

## Alternativa (eu faço mais via API)

Se preferir, crie uma **API Key** no Render (*Account Settings → API Keys*) e me envie: com ela
eu consigo orquestrar a criação/deploy via API. Mesmo assim, **conectar o GitHub ao Render**
precisa ser feito uma vez por você no painel.
