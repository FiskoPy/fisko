# Google OAuth — Setup (Marco 1, ambiente de teste)

Passo a passo para habilitar o login com Google no Fisko. Fazer logado na conta
Google do projeto (ex.: a conta Fisko no Google Cloud). Ao final, o botão
"Continuar con Google" no app fica funcional.

## Dados do app (já definidos)

| Item | Valor |
|---|---|
| Android `applicationId` | `com.fisko.app` |
| iOS `bundleId` | `com.fisko.app` |
| **SHA-1 (debug keystore)** | `AE:19:9E:00:D3:20:0A:0E:DE:19:7C:92:62:37:7F:5B:A3:47:47:C8` |

> O SHA-1 acima é do **debug keystore** desta máquina (`~/.android/debug.keystore`),
> suficiente para testes. Para release/produção, gerar um keystore próprio e
> registrar **também** o SHA-1 dele.
> Recalcular a qualquer momento:
> ```bash
> keytool -list -v -keystore ~/.android/debug.keystore \
>   -alias androiddebugkey -storepass android -keypass android | grep SHA1
> ```

## 1. Projeto + Consent screen

1. https://console.cloud.google.com → criar/selecionar um projeto (ex.: `fisko-dev`).
2. **APIs & Services → OAuth consent screen**: User Type **External**, preencher nome
   do app (Fisko), e-mail de suporte. Em **Test users**, adicionar os e-mails que vão
   testar o login (enquanto o app estiver em "Testing").

## 2. Criar os 3 OAuth Client IDs

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

### a) Web (é o que o código usa)
- Application type: **Web application**.
- Nome: `fisko-web`.
- **Guardar o Client ID** → este é o valor usado tanto no backend quanto no app.

### b) Android
- Application type: **Android**.
- Package name: `com.fisko.app`.
- SHA-1: `AE:19:9E:00:D3:20:0A:0E:DE:19:7C:92:62:37:7F:5B:A3:47:47:C8`.
- (O ID deste client não é referenciado diretamente no código, mas precisa existir
  para o Google Sign-In funcionar no Android.)

### c) iOS
- Application type: **iOS**.
- Bundle ID: `com.fisko.app`.
- Depois, no `ios/Runner/Info.plist`, adicionar o **iOS URL scheme** (o "reversed
  client ID" que o Google mostra, formato `com.googleusercontent.apps.XXXX`).

## 3. Ligar no Fisko

O `google_sign_in` no Android pede um `serverClientId` (o **Web client ID**) para
devolver um `idToken` cujo *audience* é esse Web client ID — e o backend valida o
token contra esse mesmo ID. Portanto, **use o Web Client ID nos dois lados**:

**Backend** — `apps/api/.env`:
```
GOOGLE_CLIENT_ID=<WEB_CLIENT_ID>
```

**Mobile** — passar no run/build:
```bash
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 \
  --dart-define=GOOGLE_OAUTH_CLIENT_ID=<WEB_CLIENT_ID>
```

## 4. Testar

1. Reiniciar o backend após editar o `.env`.
2. Rodar o app com o `--dart-define` acima, em um device/emulador com Google Play.
3. Tocar em **"Continuar con Google"**, escolher uma conta (que esteja em *Test users*).
4. Esperado: o app chama `POST /api/v1/auth/google`, o backend verifica o `idToken`,
   faz upsert do usuário e devolve tokens → navega para o dashboard.

## Notas de produção (Marcos futuros)
- Publicar o consent screen (sair de "Testing") quando for a produção.
- Registrar o SHA-1 do keystore de **release**.
- Migrar o projeto Google Cloud para o nome do CONTRATANTE antes da publicação.
