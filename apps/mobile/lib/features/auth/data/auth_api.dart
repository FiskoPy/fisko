import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import 'models/auth_models.dart';

/// Thin wrapper over the /auth endpoints. Throws DioException on failure;
/// the repository maps those to domain failures.
class AuthApi {
  AuthApi(this._dio);

  final Dio _dio;

  Future<AuthResponse> register({
    required String name,
    required String email,
    required String password,
    String? ruc,
    int? rucDv,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>('/auth/register', data: {
      'name': name,
      'email': email,
      'password': password,
      if (ruc != null && ruc.isNotEmpty) 'ruc': ruc,
      if (ruc != null && ruc.isNotEmpty && rucDv != null) 'rucDv': rucDv,
    });
    return AuthResponse.fromJson(res.data!);
  }

  Future<AuthResponse> login({required String email, required String password}) async {
    final res = await _dio.post<Map<String, dynamic>>('/auth/login', data: {
      'email': email,
      'password': password,
    });
    return AuthResponse.fromJson(res.data!);
  }

  Future<AuthResponse> google({required String idToken}) async {
    final res = await _dio.post<Map<String, dynamic>>('/auth/google', data: {
      'idToken': idToken,
    });
    return AuthResponse.fromJson(res.data!);
  }

  Future<void> forgotPassword({required String email}) async {
    await _dio.post<Map<String, dynamic>>('/auth/forgot-password', data: {'email': email});
  }

  Future<void> resetPassword({required String token, required String newPassword}) async {
    await _dio.post<Map<String, dynamic>>('/auth/reset-password', data: {
      'token': token,
      'newPassword': newPassword,
    });
  }

  Future<AuthUser> me() async {
    final res = await _dio.get<Map<String, dynamic>>('/auth/me');
    return AuthUser.fromJson(res.data!['user'] as Map<String, dynamic>);
  }

  Future<void> logout() async {
    await _dio.post<Map<String, dynamic>>('/auth/logout');
  }
}

final authApiProvider = Provider<AuthApi>((ref) {
  return AuthApi(ref.watch(dioProvider));
});
