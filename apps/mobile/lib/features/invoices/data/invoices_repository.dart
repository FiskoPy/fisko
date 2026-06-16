import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/failures.dart';
import 'invoices_api.dart';
import 'models/invoice_models.dart';

/// Coordinates the invoices API and maps transport errors to domain Failures.
class InvoicesRepository {
  InvoicesRepository(this._api);

  final InvoicesApi _api;

  Future<Invoice> importXml(String xml) => _run(() => _api.importXml(xml));
  Future<InvoiceList> list({int page = 1, int pageSize = 20}) =>
      _run(() => _api.list(page: page, pageSize: pageSize));
  Future<Invoice> detail(String id) => _run(() => _api.detail(id));
  Future<void> delete(String id) => _run(() => _api.delete(id));

  Future<T> _run<T>(Future<T> Function() action) async {
    try {
      return await action();
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  Failure _mapError(DioException e) {
    final status = e.response?.statusCode;
    final body = e.response?.data;
    final message = body is Map && body['error'] is Map
        ? (body['error']['message'] as String?)
        : null;

    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return const NetworkFailure('No se pudo conectar con el servidor');
    }
    if (status == 409) return ValidationFailure(message ?? 'Esta factura ya fue importada');
    if (status == 400) return ValidationFailure(message ?? 'XML inválido');
    if (status == 401 || status == 403) return AuthFailure(message ?? 'Sesión expirada');
    if (status == 404) return ValidationFailure(message ?? 'No encontrado');
    return UnknownFailure(message ?? 'Ocurrió un error inesperado');
  }
}

final invoicesRepositoryProvider = Provider<InvoicesRepository>((ref) {
  return InvoicesRepository(ref.watch(invoicesApiProvider));
});
