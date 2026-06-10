import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fisko/app.dart';
import 'package:fisko/core/storage/token_storage.dart';

/// Fake storage so the widget test doesn't hit the platform secure-storage
/// channel (which is unavailable in the test environment).
class _FakeTokenStorage implements TokenStorage {
  @override
  Future<void> clear() async {}

  @override
  Future<bool> hasSession() async => false;

  @override
  Future<String?> readAccessToken() async => null;

  @override
  Future<String?> readRefreshToken() async => null;

  @override
  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {}
}

void main() {
  testWidgets('App boots and lands on the login screen when no session exists',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [tokenStorageProvider.overrideWithValue(_FakeTokenStorage())],
        child: const FiskoApp(),
      ),
    );

    // First frame: auth status is unknown → splash loader.
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // Resolve the session check (no token → unauthenticated → /login).
    await tester.pumpAndSettle();

    // Login screen renders the email field and the Fisko title.
    expect(find.text('Fisko'), findsWidgets);
    expect(find.byType(TextFormField), findsWidgets);
  });
}
