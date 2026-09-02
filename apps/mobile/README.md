# Fisko — Mobile (Flutter)

App Flutter (feature-first) para o Marco 1: autenticação completa + navegação base.

> **Status:** scaffold entregue como código. As pastas de plataforma (`android/`,
> `ios/`) ainda **não** foram geradas nesta máquina (Flutter SDK ausente no ambiente
> de desenvolvimento usado). Veja "Primeiro setup" abaixo.

## Primeiro setup (gerar plataformas + codegen)

```bash
cd apps/mobile

# 1. Gera as pastas android/ e ios/ SEM sobrescrever lib/
flutter create . --platforms=android,ios --org com.fisko --project-name fisko

# 2. Ajustar o identificador para com.fisko.app:
#    - Android: applicationId em android/app/build.gradle
#    - iOS: PRODUCT_BUNDLE_IDENTIFIER no Xcode (Runner target)

# 3. Dependências + geração de código (freezed/json + l10n)
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter gen-l10n
```

## Rodar

```bash
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 \
  --dart-define=GOOGLE_OAUTH_CLIENT_ID=<seu-client-id-web>
```

- `10.0.2.2` é o alias do emulador Android para o `localhost` da máquina host.
- Em iOS Simulator use `http://localhost:3000/api/v1`.

## Builds

**Release (Android) — use sempre o script:**

```bash
node ../../scripts/build-apk.js
```

Ele injeta os `--dart-define`, recusa uma `API_BASE_URL` que um celular real nao
alcanca, e **confere no binario compilado** que a URL de producao entrou.

> **Nunca** rode `flutter build apk --release` puro para entregar. `Env.apiBaseUrl`
> tem `defaultValue` igual ao alias do emulador (`10.0.2.2`), entao o APK compila,
> instala e abre — e toda chamada morre no socket, com o app dizendo ao testador
> "Sin conexion. Revisa tu internet". Ja foi entregue assim uma vez.

iOS (assinatura no Xcode) — os mesmos defines sao obrigatorios:

```bash
flutter build ios --release   --dart-define=API_BASE_URL=https://fisko-api-gxyk.onrender.com/api/v1   --dart-define=GOOGLE_OAUTH_CLIENT_ID=<client-id-web>
```

## Estrutura (feature-first)

```
lib/
├── main.dart / app.dart
├── core/            # config, router (go_router + guarda), network (dio), storage, theme, errors
├── features/
│   ├── auth/        # data / application (Riverpod) / domain (ruc_validator) / presentation
│   ├── shell/       # AppShell (bottom nav)
│   ├── dashboard|captura|relatorios|perfil/   # placeholders (Marco 1)
├── l10n/            # ARB es-PY
└── shared/widgets/
```

## Arquivos gerados (não versionados)

`*.freezed.dart`, `*.g.dart` e `lib/l10n/generated/` são produzidos por
`build_runner` / `gen-l10n` — rode os comandos do setup antes de `flutter analyze`.
