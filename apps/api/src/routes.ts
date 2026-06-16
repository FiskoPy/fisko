import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { invoicesRouter } from './modules/invoices/invoices.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { emailRouter } from './modules/email/email.routes';

/** Aggregates all /api/v1 routes. */
export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'fisko-api' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/email', emailRouter);
