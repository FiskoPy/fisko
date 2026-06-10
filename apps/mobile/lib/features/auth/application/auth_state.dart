import '../data/models/auth_models.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

/// Immutable auth state held by [AuthController].
class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.user,
    this.isSubmitting = false,
    this.errorMessage,
    this.infoMessage,
  });

  final AuthStatus status;
  final AuthUser? user;
  final bool isSubmitting;
  final String? errorMessage;
  final String? infoMessage;

  bool get isAuthenticated => status == AuthStatus.authenticated;

  AuthState copyWith({
    AuthStatus? status,
    AuthUser? user,
    bool? isSubmitting,
    String? errorMessage,
    String? infoMessage,
    bool clearMessages = false,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: clearMessages ? null : (errorMessage ?? this.errorMessage),
      infoMessage: clearMessages ? null : (infoMessage ?? this.infoMessage),
    );
  }
}
