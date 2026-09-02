import 'package:flutter_test/flutter_test.dart';

import 'package:fisko/core/config/env.dart';

/// A release APK built without --dart-define silently inherits the emulator
/// default (10.0.2.2), which is unroutable from a real phone. Every request
/// then fails at the socket, and the app tells the tester to check their
/// internet — blaming the user for a build mistake. It shipped once; this is
/// the guard that makes it visible instead of silent.
void main() {
  group('isLocalApiBase', () {
    test('flags the Android emulator alias', () {
      expect(Env.isLocalApiBaseUrl('http://10.0.2.2:3000/api/v1'), isTrue);
    });

    test('flags localhost and the loopback address', () {
      expect(Env.isLocalApiBaseUrl('http://localhost:3000/api/v1'), isTrue);
      expect(Env.isLocalApiBaseUrl('http://127.0.0.1:3000/api/v1'), isTrue);
      expect(Env.isLocalApiBaseUrl('http://[::1]:3000/api/v1'), isTrue);
    });

    test('flags an empty base url — nothing can be reached', () {
      expect(Env.isLocalApiBaseUrl(''), isTrue);
    });

    test('flags a private LAN address: a tester off that network gets nothing', () {
      expect(Env.isLocalApiBaseUrl('http://192.168.0.14:3000/api/v1'), isTrue);
      expect(Env.isLocalApiBaseUrl('http://10.1.2.3:3000/api/v1'), isTrue);
    });

    test('accepts the deployed API', () {
      expect(
        Env.isLocalApiBaseUrl('https://fisko-api-gxyk.onrender.com/api/v1'),
        isFalse,
      );
    });

    test('does not flag a public host that merely contains the digits', () {
      expect(Env.isLocalApiBaseUrl('https://10-0-2-2.example.com/api/v1'), isFalse);
    });
  });
}
