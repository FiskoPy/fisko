import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

/// A connected mailbox (returned by the API; secrets never leave the server).
class EmailConnection {
  EmailConnection({
    required this.id,
    required this.provider,
    required this.email,
    required this.host,
    this.lastSyncAt,
    this.lastSyncInfo,
  });

  final String id;
  final String provider;
  final String email;
  final String host;
  final DateTime? lastSyncAt;
  final SyncResult? lastSyncInfo;

  factory EmailConnection.fromJson(Map<String, dynamic> j) {
    return EmailConnection(
      id: j['id'] as String,
      provider: j['provider'] as String,
      email: j['email'] as String,
      host: j['host'] as String,
      lastSyncAt: j['lastSyncAt'] != null ? DateTime.tryParse(j['lastSyncAt'] as String) : null,
      lastSyncInfo: j['lastSyncInfo'] is Map<String, dynamic>
          ? SyncResult.fromJson(j['lastSyncInfo'] as Map<String, dynamic>)
          : null,
    );
  }
}

/// Outcome of a mailbox sync.
class SyncResult {
  SyncResult({
    required this.scanned,
    required this.imported,
    required this.duplicated,
    required this.failed,
  });

  final int scanned;
  final int imported;
  final int duplicated;
  final int failed;

  factory SyncResult.fromJson(Map<String, dynamic> j) {
    int v(String k) => (j[k] as num?)?.toInt() ?? 0;
    return SyncResult(
      scanned: v('scanned'),
      imported: v('imported'),
      duplicated: v('duplicated'),
      failed: v('failed'),
    );
  }
}

/// Thin wrapper over the /email endpoints.
class EmailApi {
  EmailApi(this._dio);

  final Dio _dio;

  Future<List<EmailConnection>> status() async {
    final res = await _dio.get<Map<String, dynamic>>('/email/status');
    final list = (res.data!['connections'] as List).cast<Map<String, dynamic>>();
    return list.map(EmailConnection.fromJson).toList();
  }

  Future<EmailConnection> connect({
    required String provider,
    required String email,
    required String appPassword,
    String? host,
    int? port,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>('/email/connect', data: {
      'provider': provider,
      'email': email,
      'appPassword': appPassword,
      if (host != null) 'host': host,
      if (port != null) 'port': port,
    });
    return EmailConnection.fromJson(res.data!['connection'] as Map<String, dynamic>);
  }

  Future<SyncResult> sync(String id, {int? sinceDays}) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/email/$id/sync',
      data: {if (sinceDays != null) 'sinceDays': sinceDays},
    );
    return SyncResult.fromJson(res.data!['result'] as Map<String, dynamic>);
  }

  Future<void> disconnect(String id) async {
    await _dio.delete<Map<String, dynamic>>('/email/$id');
  }
}

final emailApiProvider = Provider<EmailApi>((ref) => EmailApi(ref.watch(dioProvider)));

/// Loads the current user's connected mailboxes.
final emailConnectionsProvider = FutureProvider.autoDispose<List<EmailConnection>>((ref) {
  return ref.watch(emailApiProvider).status();
});
