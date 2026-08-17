import 'package:dio/dio.dart';

/// Turns any thrown object into a short, user-facing message in Spanish.
///
/// Never surfaces raw Dio/exception text: Dio's `message` for a bad status is a
/// multi-paragraph English dump ("This exception was thrown because the
/// response has a status code of 503...") which used to leak into the UI.
String friendlyError(Object e) {
  if (e is DioException) {
    // The API's standard error envelope: { error: { code, message } }.
    final data = e.response?.data;
    if (data is Map && data['error'] is Map && data['error']['message'] != null) {
      return data['error']['message'].toString();
    }

    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'El servidor tardó demasiado en responder. Probá de nuevo en unos segundos.';
      case DioExceptionType.connectionError:
        return 'Sin conexión. Revisá tu internet e intentá de nuevo.';
      case DioExceptionType.cancel:
        return 'Operación cancelada.';
      default:
        break;
    }

    final status = e.response?.statusCode;
    if (status != null) {
      if (status == 401 || status == 403) {
        return 'Tu sesión expiró. Iniciá sesión de nuevo.';
      }
      if (status == 404) return 'No se encontró el recurso solicitado.';
      if (status == 429) return 'Demasiados intentos. Esperá un momento.';
      // 502/503/504 on free hosting = the instance is waking up.
      if (status >= 500) {
        return 'El servidor se está iniciando. Esperá unos segundos y probá de nuevo.';
      }
    }
    return 'No se pudo completar la operación. Probá de nuevo.';
  }

  return 'Ocurrió un error inesperado. Probá de nuevo.';
}
