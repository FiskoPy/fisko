import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error';
import { logger } from '../lib/logger';

/** 404 fallback for unmatched routes. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message:
        'Esa función no existe en el servidor. Puede que tu app esté desactualizada.',
    },
  });
};

/**
 * Central error handler. Renders the standard envelope required by ESCOPO.md:
 *   { error: { code, message, details? } }
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // body-parser rejects an oversized payload with its own error shape; without
  // this it surfaced as a bare 500 "Internal server error".
  const asPayload = err as { type?: string; status?: number };
  if (asPayload?.type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'El archivo es demasiado grande para enviarlo. Probá con una foto más liviana o un XML más chico.',
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        // The app shows this message verbatim, so a generic English line told
        // the user nothing. The first issue's message names the actual field
        // rule; `details` stays for whoever reads the logs.
        message:
          err.issues[0]?.message ??
          'Revisá los datos que cargaste: hay un campo mal completado.',
        details: err.flatten(),
      },
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message:
        'Tuvimos un problema en el servidor. No es tu internet. Probá de nuevo en unos minutos.',
    },
  });
};
