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

  /// Lists invoices, optionally only those ISSUED within [from]..[to].
  ///
  /// The dates are the ones printed on the invoice, which is what a month's
  /// closing is about: an August invoice loaded in September belongs to
  /// August's IVA, however late it arrived.
  Future<InvoiceList> list({
    int page = 1,
    int pageSize = 20,
    DateTime? from,
    DateTime? to,
    String? tipo,
  }) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/invoices',
      queryParameters: {
        'page': page,
        'pageSize': pageSize,
        if (from != null) 'from': from.toIso8601String().substring(0, 10),
        if (to != null) 'to': to.toIso8601String().substring(0, 10),
        if (tipo != null) 'tipo': tipo,
      },
    );
    return InvoiceList.fromJson(res.data!);
  }

  Future<Invoice> detail(String id) async {
    final res = await _dio.get<Map<String, dynamic>>('/invoices/$id');
    return Invoice.fromJson(res.data!['invoice'] as Map<String, dynamic>);
  }

  /// Files the invoice under [categoria], or back under the rules (null).
  Future<Invoice> setCategoria(String id, String? categoria) async {
    final res = await _dio.patch<Map<String, dynamic>>(
      '/invoices/$id/categoria',
      data: {'categoria': categoria},
    );
    return Invoice.fromJson(res.data!['invoice'] as Map<String, dynamic>);
  }

  /// Files the invoice as a sale or a purchase, or back under the RUC (null).
  Future<Invoice> setTipo(String id, String? tipo) async {
    final res = await _dio.patch<Map<String, dynamic>>(
      '/invoices/$id/tipo',
      data: {'tipo': tipo},
    );
    return Invoice.fromJson(res.data!['invoice'] as Map<String, dynamic>);
  }

  Future<void> delete(String id) async {
    await _dio.delete<Map<String, dynamic>>('/invoices/$id');
  }
}

final invoicesApiProvider = Provider<InvoicesApi>((ref) {
  return InvoicesApi(ref.watch(dioProvider));
});
