import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/failures.dart';
import '../data/auth_repository.dart';
import 'auth_state.dart';

/// Owns the authentication state and exposes the auth actions used by the UI.
/// The [GoRouter] redirect listens to [AuthStatus] to guard routes.
class AuthController extends Notifier<AuthState> {
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  AuthState build() {
    // Kick off the session check; state starts as `unknown`.
    Future.microtask(_restoreSession);
    return const AuthState();
  }

  Future<void> _restoreSession() async {
    final hasSession = await _repo.hasSession();
    if (!hasSession) {
      state = state.copyWith(status: AuthStatus.unauthenticated);
      return;
    }
    try {
      final user = await _repo.me();
      state = state.copyWith(status: AuthStatus.authenticated, user: user);
    } catch (_) {
      state = state.copyWith(status: AuthStatus.unauthenticated);
    }
  }

  Future<bool> login({required String email, required String password}) {
    return _submit(() async {
      final user = await _repo.login(email: email, password: password);
      state = state.copyWith(status: AuthStatus.authenticated, user: user);
    });
  }

  Future<bool> register({
    required String name,
    required String email,
    required String password,
    String? ruc,
    int? rucDv,
  }) {
    return _submit(() async {
      final user = await _repo.register(
        name: name,
        email: email,
        password: password,
        ruc: ruc,
        rucDv: rucDv,
      );
      state = state.copyWith(status: AuthStatus.authenticated, user: user);
    });
  }

  Future<bool> loginWithGoogle(String idToken) {
    return _submit(() async {
      final user = await _repo.google(idToken: idToken);
      state = state.copyWith(status: AuthStatus.authenticated, user: user);
    });
  }

  Future<bool> forgotPassword(String email) {
    return _submit(
      () => _repo.forgotPassword(email: email),
      infoMessage: 'Si el correo existe, enviamos un enlace de recuperación.',
    );
  }

  Future<bool> resetPassword({required String token, required String newPassword}) {
    return _submit(
      () => _repo.resetPassword(token: token, newPassword: newPassword),
      infoMessage: 'Contraseña actualizada. Iniciá sesión.',
    );
  }

  Future<void> logout() async {
    await _repo.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  void clearMessages() => state = state.copyWith(clearMessages: true);

  /// Runs [action] toggling the submitting flag and mapping failures to a
  /// user-facing message. Returns true on success.
  Future<bool> _submit(Future<void> Function() action, {String? infoMessage}) async {
    state = state.copyWith(isSubmitting: true, clearMessages: true);
    try {
      await action();
      state = state.copyWith(isSubmitting: false, infoMessage: infoMessage);
      return true;
    } on Failure catch (f) {
      state = state.copyWith(isSubmitting: false, errorMessage: f.message);
      return false;
    } catch (_) {
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: 'Ocurrió un error inesperado',
      );
      return false;
    }
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
