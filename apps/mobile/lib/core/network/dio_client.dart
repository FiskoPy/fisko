import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show ValueNotifier, visibleForTesting;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/env.dart';
import '../storage/token_storage.dart';

/// Builds the app's Dio instance with:
///  - base URL from Env
///  - Bearer token injection from secure storage
///  - automatic refresh on 401 (single retry) via /auth/refresh
class DioClient {
  DioClient(this._tokenStorage) {
    dio = Dio(
      BaseOptions(
        baseUrl: Env.apiBaseUrl,
        // Generous timeouts: free hosting (Render) can cold-start ~50s after idle.
        connectTimeout: const Duration(seconds: 60),
        receiveTimeout: const Duration(seconds: 60),
        contentType: 'application/json',
      ),
    );
    dio.interceptors.add(_authInterceptor());
  }

  final TokenStorage _tokenStorage;
  late final Dio dio;

  /// Fires (increments) whenever the client gives up on the session: the
  /// refresh token was rejected or missing. Until now this path only cleared
  /// storage, so the UI stayed on an authenticated screen while every request
  /// went out without a Bearer — the user saw "Missing Bearer token" instead
  /// of the login screen. AuthController listens and flips to unauthenticated.
  final ValueNotifier<int> sessionExpired = ValueNotifier<int>(0);

  /// A 401/403 from the refresh endpoint means the refresh token itself was
  /// rejected. Anything else (5xx, timeout, connection error) is transport.
  static bool _isAuthRejection(DioException e) {
    final s = e.response?.statusCode;
    return s == 401 || s == 403;
  }

  Future<void> _dropSession() async {
    await _tokenStorage.clear();
    sessionExpired.value++;
  }

  /// A bare client without interceptors, used for the refresh call so we do not
  /// recurse into the 401 handler. Built once (it used to be rebuilt on every
  /// 401) and exposed so tests can stub its adapter — otherwise any test of the
  /// refresh path reaches the real network.
  @visibleForTesting
  late final Dio refreshClient = Dio(
    BaseOptions(
      baseUrl: Env.apiBaseUrl,
      // Same generous timeouts as the main client: this call also has to
      // survive a cold start, and a bare Dio would give up after 0ms/none.
      connectTimeout: const Duration(seconds: 60),
      receiveTimeout: const Duration(seconds: 60),
    ),
  );

  InterceptorsWrapper _authInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        // Skip auth header for the auth endpoints that don't need it.
        final token = await _tokenStorage.readAccessToken();
        if (token != null && options.headers['Authorization'] == null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        final isUnauthorized = error.response?.statusCode == 401;
        final alreadyRetried = error.requestOptions.extra['__retried'] == true;
        final isRefreshCall = error.requestOptions.path.contains('/auth/refresh');

        if (!isUnauthorized || alreadyRetried || isRefreshCall) {
          return handler.next(error);
        }

        final refreshToken = await _tokenStorage.readRefreshToken();
        if (refreshToken == null) {
          await _dropSession();
          return handler.next(error);
        }

        try {
          final res = await refreshClient.post<Map<String, dynamic>>(
            '/auth/refresh',
            data: {'refreshToken': refreshToken},
          );
          final tokens = res.data?['tokens'] as Map<String, dynamic>?;
          if (tokens == null) {
            await _dropSession();
            return handler.next(error);
          }
          await _tokenStorage.saveTokens(
            accessToken: tokens['accessToken'] as String,
            refreshToken: tokens['refreshToken'] as String,
          );

          // Retry the original request with the new token.
          final req = error.requestOptions;
          req.extra['__retried'] = true;
          req.headers['Authorization'] = 'Bearer ${tokens['accessToken']}';
          final retried = await dio.fetch<dynamic>(req);
          return handler.resolve(retried);
        } on DioException catch (e) {
          // Only a genuine rejection ends the session. Transport failures — a
          // Render cold-start 503, a timeout, no signal, a 429 from the auth
          // limiter — are temporary, and dropping the tokens there would throw
          // away a valid 30-day session over a hiccup.
          if (_isAuthRejection(e)) await _dropSession();
          return handler.next(error);
        } catch (_) {
          return handler.next(error);
        }
      },
    );
  }
}

final dioClientProvider = Provider<DioClient>((ref) {
  return DioClient(ref.watch(tokenStorageProvider));
});

final dioProvider = Provider<Dio>((ref) => ref.watch(dioClientProvider).dio);
