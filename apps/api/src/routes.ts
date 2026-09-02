import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { invoicesRouter } from './modules/invoices/invoices.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { emailRouter } from './modules/email/email.routes';
import { insightsRouter } from './modules/insights/insights.routes';
import { subscriptionsRouter } from './modules/subscriptions/subscriptions.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { env } from './config/env';

/** Aggregates all /api/v1 routes. */
export const apiRouter = Router();

/**
 * Health, plus which build answered.
 *
 * Render injects RENDER_GIT_COMMIT on every deploy. Without it there is no way
 * to tell a finished deploy from a stale container still serving the old code
 * — the endpoint said "ok" either way. The commit hash is public information
 * in a private repo's case too: it identifies a build, it does not expose one.
 */
apiRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'fisko-api',
    commit: (process.env.RENDER_GIT_COMMIT ?? 'dev').slice(0, 7),
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/email', emailRouter);
apiRouter.use('/insights', insightsRouter);
apiRouter.use('/subscriptions', subscriptionsRouter);

// Operator-only; absent entirely unless ADMIN_TOKEN is configured.
if (env.ADMIN_TOKEN) apiRouter.use('/admin', adminRouter);
