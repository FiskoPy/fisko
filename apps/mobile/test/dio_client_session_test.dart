import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:fisko/core/network/dio_client.dart';
import 'package:fisko/core/storage/token_storage.dart';
import 'package:flutter_test/flutter_test.dart';

/// Guards the 401 / refresh path in [DioClient].
///
/// A self-recursive `_dropSession()` shipped once: it compiled, `flutter
/// analyze` said nothing, and every 401 then hung the request forever instead
/// of surfacing an error — a wrong password left the login button spinning and
/// a dead refresh token left the app stuck on the splash. Nothing in the suite
/// touched the interceptor, so nothing caught it. These tests do.
class _FakeStorage implements TokenStorage {
  _FakeStorage({this.access, this.refresh});

  String? access;
  String? refresh;
  int clears = 0;

  @override
  Future<String?> readAccessToken() async => access;

  @override
  Future<String?> readRefreshToken() async => refresh;

  @override
  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    access = accessToken;
    refresh = refreshToken;
  }

  @override
  Future<void> clear() async {
    clears++;
    access = null;
    refresh = null;
  }

  @override
  Future<bool> hasSession() async => access != null;
}

/// Answers every request with a fixed status, recording what it saw.
class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.status, {this.body = '{"error":{"code":"UNAUTHORIZED"}}'});

  final int status;
  final String body;
  final List<String> paths = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    paths.add(options.path);
    return ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Every case here must finish well inside this; a hang is the bug under test.
Future<T> _within<T>(Future<T> future) =>
    future.timeout(const Duration(seconds: 5));

void main() {
  group('DioClient 401 handling', () {
    test('a 401 with no refresh token fails fast and clears the session',
        () async {
      // The wrong-password case: nothing is stored yet, so there is nothing to
      // refresh with. It must surface as an error, not hang.
      final storage = _FakeStorage();
      final client = DioClient(storage);
      client.dio.httpClientAdapter = _StubAdapter(401);

      await expectLater(
        _within(client.dio.post<dynamic>('/auth/login')),
        throwsA(isA<DioException>()),
      );
      expect(storage.clears, 1, reason: 'must drop whatever was stored');
      expect(client.sessionExpired.value, 1, reason: 'must signal the UI');
    });

    test('a rejected refresh fails the original request and signals expiry',
        () async {
      // The password-was-reset-elsewhere case: tokens exist but the server has
      // moved on (tokenVersion bumped), so /auth/refresh answers 401 too.
      final storage = _FakeStorage(access: 'stale', refresh: 'stale');
      final client = DioClient(storage);
      client.dio.httpClientAdapter = _StubAdapter(401);
      // The refresh goes out on its own client; stub it too or the test
      // reaches the real server.
      client.refreshClient.httpClientAdapter = _StubAdapter(401);

      await expectLater(
        _within(client.dio.get<dynamic>('/auth/me')),
        throwsA(isA<DioException>()),
      );
      expect(storage.access, isNull, reason: 'stale tokens must not survive');
      expect(client.sessionExpired.value, 1);
    });

    test('a 503 on refresh keeps the session (cold start is not a logout)',
        () async {
      // The homologation server sleeps and its edge answers 503 while it wakes.
      // Treating that like a rejected refresh threw away a valid 30-day
      // session — the user was bounced to login for a hiccup.
      final storage = _FakeStorage(access: 'good', refresh: 'good');
      final client = DioClient(storage);
      client.dio.httpClientAdapter = _StubAdapter(401);
      client.refreshClient.httpClientAdapter =
          _StubAdapter(503, body: 'service unavailable');

      await expectLater(
        _within(client.dio.get<dynamic>('/auth/me')),
        throwsA(isA<DioException>()),
      );
      expect(storage.refresh, 'good', reason: 'tokens must survive a 503');
      expect(storage.clears, 0);
      expect(client.sessionExpired.value, 0, reason: 'do not log the user out');
    });

    test('a non-401 error is passed through untouched', () async {
      final storage = _FakeStorage(access: 'good', refresh: 'good');
      final client = DioClient(storage);
      client.dio.httpClientAdapter =
          _StubAdapter(500, body: '{"error":{"code":"INTERNAL"}}');

      await expectLater(
        _within(client.dio.get<dynamic>('/invoices')),
        throwsA(isA<DioException>()),
      );
      expect(storage.clears, 0, reason: 'a server fault is not a dead session');
      expect(client.sessionExpired.value, 0);
    });

    test('the access token is attached when one is stored', () async {
      final storage = _FakeStorage(access: 'abc', refresh: 'def');
      final client = DioClient(storage);
      final adapter = _StubAdapter(200, body: '{}');
      client.dio.httpClientAdapter = adapter;

      String? sentAuth;
      client.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (o, h) {
            sentAuth = o.headers['Authorization'] as String?;
            h.next(o);
          },
        ),
      );

      await _within(client.dio.get<dynamic>('/invoices'));
      expect(sentAuth, 'Bearer abc');
    });
  });
}
