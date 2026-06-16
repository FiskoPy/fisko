import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import 'models/summary_models.dart';

class ReportsApi {
  ReportsApi(this._dio);

  final Dio _dio;

  Future<FiscalSummary> summary() async {
    final res = await _dio.get<Map<String, dynamic>>('/reports/summary');
    return FiscalSummary.fromJson(res.data!);
  }

  /// Downloads the report as bytes. [format] is 'pdf' or 'excel'.
  Future<Uint8List> export(String format) async {
    final res = await _dio.get<List<int>>(
      '/reports/export',
      queryParameters: {'format': format},
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(res.data ?? const []);
  }
}

final reportsApiProvider = Provider<ReportsApi>((ref) {
  return ReportsApi(ref.watch(dioProvider));
});
