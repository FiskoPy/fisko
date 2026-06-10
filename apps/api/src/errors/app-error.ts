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

  static unauthorized(message = 'Unauthorized', details?: unknown) {
    return new AppError(401, 'UNAUTHORIZED', message, details);
  }

  static forbidden(message = 'Forbidden', details?: unknown) {
    return new AppError(403, 'FORBIDDEN', message, details);
  }

  static notFound(message = 'Not found', details?: unknown) {
    return new AppError(404, 'NOT_FOUND', message, details);
  }

  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }

  static tooManyRequests(message = 'Too many requests') {
    return new AppError(429, 'TOO_MANY_REQUESTS', message);
  }

  static internal(message = 'Internal server error') {
    return new AppError(500, 'INTERNAL', message);
  }
}
