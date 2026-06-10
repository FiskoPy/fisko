import 'package:freezed_annotation/freezed_annotation.dart';

part 'auth_models.freezed.dart';
part 'auth_models.g.dart';

/// Public user as returned by the API (`toPublicUser`).
@freezed
class AuthUser with _$AuthUser {
  const factory AuthUser({
    required String id,
    required String email,
    required String name,
    String? ruc,
    int? rucDv,
    @Default(false) bool emailVerified,
    DateTime? createdAt,
  }) = _AuthUser;

  factory AuthUser.fromJson(Map<String, dynamic> json) => _$AuthUserFromJson(json);
}

/// Access + refresh token pair.
@freezed
class AuthTokens with _$AuthTokens {
  const factory AuthTokens({
    required String accessToken,
    required String refreshToken,
  }) = _AuthTokens;

  factory AuthTokens.fromJson(Map<String, dynamic> json) => _$AuthTokensFromJson(json);
}

/// Response envelope for register/login/google: { user, tokens }.
@freezed
class AuthResponse with _$AuthResponse {
  const factory AuthResponse({
    required AuthUser user,
    required AuthTokens tokens,
  }) = _AuthResponse;

  factory AuthResponse.fromJson(Map<String, dynamic> json) => _$AuthResponseFromJson(json);
}
