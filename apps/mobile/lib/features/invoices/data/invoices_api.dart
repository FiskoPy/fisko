import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import 'models/invoice_models.dart';

/// Thin wrapper over the /invoices endpoints.
class InvoicesApi {
  InvoicesApi(this._dio);

  final Dio _dio;

  Future<Invoice> importXml(String xml) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/invoices/import-xml',
      data: {'xml': xml},
    );
    return Invoice.fromJson(res.data!['invoice'] as Map<String, dynamic>);
  }

  Future<InvoiceList> list({int page = 1, int pageSize = 20}) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/invoices',
      queryParameters: {'page': page, 'pageSize': pageSize},
    );
    return InvoiceList.fromJson(res.data!);
  }

  Future<Invoice> detail(String id) async {
    final res = await _dio.get<Map<String, dynamic>>('/invoices/$id');
    return Invoice.fromJson(res.data!['invoice'] as Map<String, dynamic>);
  }

  Future<void> delete(String id) async {
    await _dio.delete<Map<String, dynamic>>('/invoices/$id');
  }
}

final invoicesApiProvider = Provider<InvoicesApi>((ref) {
  return InvoicesApi(ref.watch(dioProvider));
});
