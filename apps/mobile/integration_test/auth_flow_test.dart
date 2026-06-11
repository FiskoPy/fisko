import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:fisko/core/errors/failures.dart';
import 'package:fisko/features/auth/data/auth_repository.dart';

/// End-to-end integration against the LIVE backend.
///
/// Prerequisites:
///   - API running and reachable at API_BASE_URL (default http://10.0.2.2:3000/api/v1
///     which is the Android-emulator alias for the host's localhost:3000).
///   - Postgres migrated.
///
/// Run:
///   flutter test integration_test/auth_flow_test.dart -d emulator-5554 \
///     --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  late ProviderContainer container;
  late AuthRepository repo;

  setUp(() {
    container = ProviderContainer();
    repo = container.read(authRepositoryProvider);
  });

  tearDown(() => container.dispose());

  final stamp = DateTime.now().microsecondsSinceEpoch;
  final email = 'e2e_$stamp@example.com';
  const password = 'Sup3rSecret!';

  testWidgets('register persists a session and returns the user', (_) async {
    // Real RUC/dv pair (DNIT-validated) to exercise server-side RUC validation.
    final user = await repo.register(
      name: 'E2E User',
      email: email,
      password: password,
      ruc: '80054993',
      rucDv: 7,
    );
    expect(user.email, email);
    expect(user.ruc, '80054993');
    expect(await repo.hasSession(), isTrue);
  });

  testWidgets('login + me round-trip parses the live response', (_) async {
    final loggedIn = await repo.login(email: email, password: password);
    expect(loggedIn.email, email);

    final me = await repo.me();
    expect(me.email, email);
    expect(me.id, loggedIn.id);
  });

  testWidgets('forgot-password always succeeds; reset rejects an invalid token',
      (_) async {
    await repo.forgotPassword(email: email); // returns normally (200)

    await expectLater(
      repo.resetPassword(token: 'not-a-valid-token', newPassword: 'An0therPass!'),
      throwsA(isA<ValidationFailure>()),
    );
  });

  testWidgets('register rejects an invalid RUC check digit', (_) async {
    await expectLater(
      repo.register(
        name: 'Bad Ruc',
        email: 'badruc_$stamp@example.com',
        password: password,
        ruc: '80054993',
        rucDv: 0, // wrong dv (correct is 7)
      ),
      throwsA(isA<ValidationFailure>()),
    );
  });
}
