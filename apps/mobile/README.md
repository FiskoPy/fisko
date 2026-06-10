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

```bash
flutter build apk --release   # Android
flutter build ios --release   # iOS (assinatura no Xcode)
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
