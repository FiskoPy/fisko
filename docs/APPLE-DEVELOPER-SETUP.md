# Apple Developer — passo a passo para criar a conta (Fisko / iOS)

Guia para criar a conta do **Apple Developer Program** e deixá-la ativa, pronta para
publicar o app iOS (TestFlight + App Store na fase de publicação).

> **Importante:** criar/pagar a conta **NÃO precisa de Mac** — faz pelo navegador.
> O Mac (+ Xcode) só é necessário depois, na hora de **compilar e assinar** o app.
> Custo: **US$ 99/ano** (renova automático). Pode cancelar a renovação quando quiser.

---

## 0. Decisão: Individual ou Organização?

| | **Individual** | **Organização (empresa)** |
|---|---|---|
| Aparece como desenvolvedor | seu **nome pessoal** | **nome da empresa** (mais profissional) |
| Tempo de aprovação | rápido (~horas a 1–2 dias) | mais demorado (dias; Apple verifica a empresa) |
| Exige **D-U-N-S Number** | não | **sim** (gratuito, mas pode levar dias) |
| Exige entidade legal (empresa/RUC) | não | sim |
| Vários membros no time | limitado | sim, com papéis |

**Recomendação:** para um produto de cliente, o ideal é **Organização no nome do
CONTRATANTE** (igual fizemos com GitHub/Google). Como o **D-U-N-S demora**, comece por
ele **hoje**. Se a prioridade for testar rápido no TestFlight, dá pra começar como
**Individual** e migrar depois.

---

## 1. Pré-requisitos (ambos os casos)

1. Um **Apple ID** (e-mail Apple). Pode criar em https://appleid.apple.com
   - Recomendo criar/usar um Apple ID **da empresa** (ex.: o e-mail institucional), não pessoal.
2. **Ativar a verificação em duas etapas (2FA)** nesse Apple ID — é obrigatório.
3. Um **cartão de crédito** para o pagamento dos US$ 99/ano.
4. (Organização) **nome legal exato da empresa**, endereço, telefone e um **site** da empresa.

---

## 2A. Caminho INDIVIDUAL (rápido)

1. Acesse **https://developer.apple.com/programs/enroll/**
2. Faça login com o **Apple ID** (com 2FA).
3. Em "Entity Type", escolha **Individual / Sole Proprietor**.
4. Confirme seus dados pessoais (nome legal como no documento, endereço).
5. Aceite os termos do **Apple Developer Program License Agreement**.
6. Pague os **US$ 99** (cartão).
7. Aguarde a confirmação por e-mail (geralmente em **24–48h**, às vezes na hora).
8. Pronto: a conta fica **ativa** em https://developer.apple.com/account

---

## 2B. Caminho ORGANIZAÇÃO (recomendado para o produto)

### Passo 1 — Conseguir o **D-U-N-S Number** (faça isso primeiro!)
- É um identificador gratuito de empresa (Dun & Bradstreet). A Apple **exige** para contas de organização.
- Verifique se a empresa já tem / solicite em:
  **https://developer.apple.com/enroll/duns-lookup/**
- Preencha os dados legais da empresa (nome, endereço, telefone).
- Pode levar de **alguns dias até ~2 semanas** para sair. **Por isso comece já.**

### Passo 2 — Fazer o enrollment
1. Com o D-U-N-S em mãos, acesse **https://developer.apple.com/programs/enroll/**
2. Login com o **Apple ID** da empresa (com 2FA).
3. Em "Entity Type", escolha **Company / Organization**.
4. Informe:
   - **Legal Entity Name** (nome legal exato, igual ao registrado no D-U-N-S),
   - **D-U-N-S Number**,
   - **Website** da empresa,
   - seu cargo / que você tem **autoridade para assinar** em nome da empresa.
5. A Apple pode **ligar/verificar** a empresa (confirme o telefone correto).
6. Aceite os termos e **pague os US$ 99**.
7. Aguarde a verificação da Apple (pode levar **alguns dias**).

---

## 3. Depois da conta ativa — adicionar o desenvolvedor ao time

Para o desenvolvedor poder compilar e subir builds (TestFlight) **sem ser o dono**:

1. O dono acessa **https://appstoreconnect.apple.com** → **Users and Access**.
2. **Invite (+)** → e-mail do desenvolvedor → papel **App Manager** (ou Developer/Admin).
3. O desenvolvedor aceita o convite e passa a ter acesso ao time da empresa.

> Assim a conta fica **no nome do CONTRATANTE** e o dev trabalha como membro — mesmo modelo do GitHub.

---

## 4. O que vem DEPOIS (não é parte da criação — é a fase de build)

Para gerar o app iOS e mandar pro TestFlight (já com a conta pronta), será necessário:
- Um **Mac com Xcode**.
- Criar o app no **App Store Connect** (bundle id `com.fisko.app`).
- **Assinatura de código**: o Xcode faz **assinatura automática** usando a conta do time
  (cria os certificados/perfis sozinho) — não precisa configurar certificado manualmente.
- Subir o build → o app fica disponível no **TestFlight** para testers.

> Resumo: **agora** = criar e pagar a conta (sem Mac). **Depois** = build + assinatura + TestFlight (com Mac).

---

## 5. Custos e prazos (resumo)
- **US$ 99/ano** (Apple Developer Program).
- **D-U-N-S**: grátis, mas demora (só organização) → **começar primeiro**.
- Aprovação: Individual ~1–2 dias; Organização alguns dias (verificação).
