/// Low-level exceptions thrown by data sources (API/storage).
class ApiException implements Exception {
  ApiException(this.message, {this.code, this.statusCode});

  final String message;
  final String? code;
  final int? statusCode;

  @override
  String toString() => 'ApiException($statusCode, $code): $message';
}

class NetworkException implements Exception {
  NetworkException([this.message = 'Network error']);
  final String message;

  @override
  String toString() => 'NetworkException: $message';
}

class UnauthorizedException implements Exception {
  UnauthorizedException([this.message = 'Unauthorized']);
  final String message;

  @override
  String toString() => 'UnauthorizedException: $message';
}
