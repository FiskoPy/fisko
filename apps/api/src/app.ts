import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger';
import { apiLimiter } from './middleware/rate-limit';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { apiRouter } from './routes';
import { legalRouter } from './modules/legal/legal.routes';

export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy (Render/Railway/etc.): trust the first proxy hop so
  // express-rate-limit and req.ip use the real client IP (X-Forwarded-For).
  app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  // Photos go through the route-scoped 12mb parser on /invoices/import-photo.
// If this global parser ran first it would consume the body and reject any
// real photo (>100kb) with 413 before that route was ever reached — which is
// exactly what happened. The 1mb ceiling covers a SIFEN DTE with many items,
// which can pass 100kb.
const PHOTO_ROUTE = '/api/v1/invoices/import-photo';
app.use(
  express.json({
    limit: '1mb',
    type: (req) =>
      (req.url ?? '').split('?')[0] !== PHOTO_ROUTE &&
      /json/i.test(String(req.headers['content-type'] ?? '')),
  }),
);
  app.use(
  pinoHttp({
    logger,
    // pino-http's default req serializer logs every header, which was writing
    // Bearer access tokens and the admin token into Render's log stream.
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-admin-token"]', 'req.headers.cookie'],
      censor: '[redacted]',
    },
  }),
);
  app.use(apiLimiter);

  // All routes live under /api/v1.
  app.use('/api/v1', apiRouter);

  // Store-required legal pages, deliberately at the root so the URLs given to
  // Google Play and App Store Connect look like web pages, not API endpoints.
  app.use('/', legalRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
