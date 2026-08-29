import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { invoicesRouter } from './modules/invoices/invoices.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { emailRouter } from './modules/email/email.routes';
import { insightsRouter } from './modules/insights/insights.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { env } from './config/env';

/** Aggregates all /api/v1 routes. */
export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'fisko-api' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/email', emailRouter);
apiRouter.use('/insights', insightsRouter);

// Operator-only; absent entirely unless ADMIN_TOKEN is configured.
if (env.ADMIN_TOKEN) apiRouter.use('/admin', adminRouter);
