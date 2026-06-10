import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/failures.dart';
import '../../../core/storage/token_storage.dart';
import 'auth_api.dart';
import 'models/auth_models.dart';

/// Coordinates the API and secure token storage, and translates transport
/// errors into domain [Failure]s for the application layer.
class AuthRepository {
  AuthRepository(this._api, this._tokenStorage);

  final AuthApi _api;
  final TokenStorage _tokenStorage;

  Future<AuthUser> register({
    required String name,
    required String email,
    required String password,
    String? ruc,
    int? rucDv,
  }) {
    return _run(() async {
      final res = await _api.register(
        name: name,
        email: email,
        password: password,
        ruc: ruc,
        rucDv: rucDv,
      );
      await _persist(res.tokens);
      return res.user;
    });
  }

  Future<AuthUser> login({required String email, required String password}) {
    return _run(() async {
      final res = await _api.login(email: email, password: password);
      await _persist(res.tokens);
      return res.user;
    });
  }

  Future<AuthUser> google({required String idToken}) {
    return _run(() async {
      final res = await _api.google(idToken: idToken);
      await _persist(res.tokens);
      return res.user;
    });
  }

  Future<void> forgotPassword({required String email}) {
    return _run(() => _api.forgotPassword(email: email));
  }

  Future<void> resetPassword({required String token, required String newPassword}) {
    return _run(() => _api.resetPassword(token: token, newPassword: newPassword));
  }

  Future<AuthUser> me() => _run(() => _api.me());

  Future<void> logout() async {
    try {
      await _api.logout();
    } catch (_) {
      // Even if the server call fails, drop local tokens.
    } finally {
      await _tokenStorage.clear();
    }
  }

  Future<bool> hasSession() => _tokenStorage.hasSession();

  Future<void> _persist(AuthTokens tokens) async {
    await _tokenStorage.saveTokens(
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    );
  }

  Future<T> _run<T>(Future<T> Function() action) async {
    try {
      return await action();
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  Failure _mapError(DioException e) {
    final status = e.response?.statusCode;
    final body = e.response?.data;
    final message = body is Map && body['error'] is Map
        ? (body['error']['message'] as String?) ?? 'Error'
        : null;

    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return const NetworkFailure('No se pudo conectar con el servidor');
    }
    if (status == 400 || status == 409) {
      return ValidationFailure(message ?? 'Datos inválidos');
    }
    if (status == 401 || status == 403) {
      return AuthFailure(message ?? 'Credenciales inválidas');
    }
    return UnknownFailure(message ?? 'Ocurrió un error inesperado');
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    ref.watch(authApiProvider),
    ref.watch(tokenStorageProvider),
  );
});
