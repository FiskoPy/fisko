/**
 * Domain/HTTP error carrying a stable machine code. The error handler renders
 * it as the standard envelope: { error: { code, message, details? } }.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Tu sesión venció. Iniciá sesión de nuevo.', details?: unknown) {
    return new AppError(401, 'UNAUTHORIZED', message, details);
  }

  static forbidden(message = 'No tenés permiso para hacer esto.', details?: unknown) {
    return new AppError(403, 'FORBIDDEN', message, details);
  }

  static notFound(message = 'No encontramos lo que buscabas.', details?: unknown) {
    return new AppError(404, 'NOT_FOUND', message, details);
  }

  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }

  static tooManyRequests(message = 'Demasiados intentos. Esperá un momento.') {
    return new AppError(429, 'TOO_MANY_REQUESTS', message);
  }

  /** The server itself cannot do this right now (e.g. no mail transport). */
  static serviceUnavailable(message = 'El servicio no está disponible ahora. Probá en unos minutos.') {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }

  static internal(message = 'Tuvimos un problema en el servidor. Probá de nuevo en unos minutos.') {
    return new AppError(500, 'INTERNAL', message);
  }
}
