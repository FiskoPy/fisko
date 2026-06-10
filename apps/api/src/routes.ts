import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';

/** Aggregates all /api/v1 routes. */
export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'fisko-api' });
});

apiRouter.use('/auth', authRouter);
