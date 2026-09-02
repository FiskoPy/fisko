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

  /// Sends a photographed paper invoice for OCR. Returns the created invoice
  /// plus whatever the reader could not make out, so the UI can say so.
  Future<({Invoice invoice, List<String> missing, double confidence})> importPhoto(
    String imageBase64,
  ) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/invoices/import-photo',
      data: {'imageBase64': imageBase64},
    );
    final d = res.data!;
    return (
      invoice: Invoice.fromJson(d['invoice'] as Map<String, dynamic>),
      missing: ((d['missing'] as List?) ?? const []).map((e) => e.toString()).toList(),
      confidence: ((d['confidence'] as num?) ?? 0).toDouble(),
    );
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
