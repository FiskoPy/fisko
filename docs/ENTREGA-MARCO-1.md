# Fisko — Entrega do Marco 1

**Status:** concluído e validado (Android). Repositório: `FiskoPy/fisko` (branch `main`).

## O que foi entregue e testado

### App (Flutter — es-PY, arquitetura feature-first)
- Cadastro e login por **e-mail/senha** com validações e tratamento de erros.
- **Login com Google (OAuth)** — verificado ponta a ponta (usuário criado no banco, navegação ao dashboard).
- **Recuperação de senha por e-mail** — homologação (Ethereal).
- **Validação de RUC (dDVEmi)** — conferida contra RUCs reais da DNIT.
- **Navegação base**: 4 abas (Início, Captura, Relatórios, Perfil) esqueletadas.

### Backend (Node/TypeScript + PostgreSQL)
- Auth JWT (access/refresh), argon2, rate-limit, helmet, e-mail de recuperação.
- **17 testes automatizados** + **21 verificações ao vivo** (inclui troca de senha real) + lint/typecheck limpos.

### Builds
- **APK Android** (build de teste) gerado.
- **iOS**: código pronto; build depende de Mac/CI macOS + conta Apple Developer (ver abaixo).

## Critérios de aceite (DoD)
| Item | Status |
|---|---|
| (a) App feature-first + repo owner = contratante | ✅ (iOS build pendente) |
| (b) Login/cadastro e-mail-senha + Google OAuth | ✅ verificado |
| (c) Recuperação de senha (homologação) | ✅ |
| (d) Navegação base | ✅ |
| (e) Build de teste — APK Android | ✅ |
| (e) Build de teste — iOS/TestFlight | ⏳ depende de conta Apple Developer |

## Assinatura do APK (Android) — situação e o que falta

- **Build de teste (atual):** o APK é assinado com a **chave de debug** padrão do Flutter.
  Isso é normal para testes — **instala e roda** em qualquer Android (basta permitir
  "instalar apps de fontes desconhecidas"). O SHA-1 dessa chave de debug já está
  registrado no client OAuth do Google, então o **login Google funciona** neste build.
- **Produção (Play Store — Marco 3):** será necessária uma **chave de release** (upload key)
  própria, configuração de `key.properties` + signing no Gradle, e registrar o **SHA-1 da
  chave de release** no client OAuth Android. A chave de release é um segredo crítico
  (perdê-la impede atualizar o app na Play depois) — fica guardada fora do repositório.
- **Conclusão:** para o **teste do Marco 1**, a assinatura atual basta. A chave de release
  é tarefa da fase de **publicação (Marco 3)**.

## Pré-requisito real para o cliente testar o APK no próprio celular

O app precisa falar com um backend **acessível pela internet**. Hoje o backend roda
localmente (na máquina de dev). Para o cliente testar sozinho:
1. **Deploy do backend** em um host com URL pública (ex.: Railway/Render) + Postgres gerenciado.
2. **Rebuild do APK** apontando para essa URL (`API_BASE_URL=https://...`) + o Google Client ID.
3. (Recuperação de senha) manter Ethereal em homologação ou plugar um SMTP real.

> Alternativa sem deploy: demonstração guiada (tela compartilhada) com o backend local.

## O que precisamos do cliente para avançar
1. **Validação e liberação do Marco 1.**
2. **Iniciar a conta Apple Developer** (US$ 99/ano) — aprovação da Apple leva alguns dias;
   convém começar já para o build iOS/TestFlight ficar pronto na publicação.
3. **Identidade visual**: cores (hex) + logo (PNG/SVG) para tema e ícones.
4. (Produção, fases futuras) migrar o projeto Google Cloud e o SMTP para o nome do contratante.
