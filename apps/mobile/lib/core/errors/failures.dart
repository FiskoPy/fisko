/// Domain-level failures surfaced to the presentation layer.
sealed class Failure {
  const Failure(this.message);
  final String message;
}

class ValidationFailure extends Failure {
  const ValidationFailure(super.message);
}

class AuthFailure extends Failure {
  const AuthFailure(super.message);
}

class NetworkFailure extends Failure {
  const NetworkFailure(super.message);
}

class UnknownFailure extends Failure {
  const UnknownFailure([super.message = 'Ocurrió un error inesperado']);
}
