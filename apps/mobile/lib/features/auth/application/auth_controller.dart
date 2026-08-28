import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/failures.dart';
import '../../../core/network/dio_client.dart';
import '../../email/data/email_api.dart';
import '../../invoices/application/invoices_controller.dart';
import '../../reports/application/summary_controller.dart';
import '../data/auth_repository.dart';
import 'auth_state.dart';

/// Owns the authentication state and exposes the auth actions used by the UI.
/// The [GoRouter] redirect listens to [AuthStatus] to guard routes.
class AuthController extends Notifier<AuthState> {
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  AuthState build() {
    // The HTTP client drops the session when a refresh is rejected (e.g. the
    // password was reset elsewhere and tokenVersion moved on). React here so
    // the router sends the user to login instead of leaving them on a screen
    // whose every request now fails with "Missing Bearer token".
    final expired = ref.watch(dioClientProvider).sessionExpired;
    void onExpired() {
      if (state.status == AuthStatus.authenticated) {
        state = const AuthState(
          status: AuthStatus.unauthenticated,
          errorMessage: 'Tu sesión venció. Iniciá sesión de nuevo.',
        );
      }
    }
    expired.addListener(onExpired);
    ref.onDispose(() => expired.removeListener(onExpired));

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
    } on AuthFailure {
      // The server rejected the token: the session really is over.
      state = state.copyWith(status: AuthStatus.unauthenticated);
    } catch (_) {
      // Anything else is the network or a sleeping server, not a verdict on
      // the session. Keep the stored tokens and let the user in; the next
      // request will refresh, and a genuine 401 lands in the branch above.
      state = state.copyWith(status: AuthStatus.authenticated);
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
    _clearAccountCaches();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Invoices and the fiscal summary are cached per provider, not per account.
  /// Without this the next person to log in on the same phone briefly sees the
  /// previous account's invoices and totals.
  void _clearAccountCaches() {
    ref.invalidate(invoicesControllerProvider);
    ref.invalidate(fiscalSummaryProvider);
    ref.invalidate(emailConnectionsProvider);
  }

  /// Deletes the account and drops the session. Returns false (with a message
  /// in state) when the server refused, so the UI does not pretend it worked.
  Future<bool> deleteAccount() async {
    final ok = await _submit(() => _repo.deleteAccount());
    if (ok) {
      _clearAccountCaches();
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
    return ok;
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
