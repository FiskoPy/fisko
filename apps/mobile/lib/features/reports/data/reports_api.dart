import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import 'models/summary_models.dart';

class ReportsApi {
  ReportsApi(this._dio);

  final Dio _dio;

  /// The whole history, or only what was ISSUED inside [month].
  Future<FiscalSummary> summary({DateTime? month}) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/reports/summary',
      queryParameters: _monthRange(month),
    );
    return FiscalSummary.fromJson(res.data!);
  }

  /// Downloads the report as bytes. [format] is 'pdf' or 'excel'.
  ///
  /// A report is handed to an accountant for one month: the IVA of August is
  /// declared in September, and a PDF holding both months is of no use to him.
  Future<Uint8List> export(String format, {DateTime? month}) async {
    final res = await _dio.get<List<int>>(
      '/reports/export',
      queryParameters: {'format': format, ..._monthRange(month)},
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(res.data ?? const []);
  }

  /// The month as the API takes it: the days it was issued between.
  Map<String, String> _monthRange(DateTime? month) {
    if (month == null) return const {};
    final from = DateTime.utc(month.year, month.month, 1);
    final to = DateTime.utc(month.year, month.month + 1, 0);
    return {
      'from': from.toIso8601String().substring(0, 10),
      'to': to.toIso8601String().substring(0, 10),
    };
  }
}

final reportsApiProvider = Provider<ReportsApi>((ref) {
  return ReportsApi(ref.watch(dioProvider));
});
