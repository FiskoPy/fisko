import 'package:dio/dio.dart';
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

  // A bare client without interceptors, used to perform the refresh call so we
  // don't recurse into the 401 handler.
  Dio get _bareClient => Dio(BaseOptions(baseUrl: Env.apiBaseUrl));

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
          await _tokenStorage.clear();
          return handler.next(error);
        }

        try {
          final res = await _bareClient.post<Map<String, dynamic>>(
            '/auth/refresh',
            data: {'refreshToken': refreshToken},
          );
          final tokens = res.data?['tokens'] as Map<String, dynamic>?;
          if (tokens == null) {
            await _tokenStorage.clear();
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
        } catch (_) {
          await _tokenStorage.clear();
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
