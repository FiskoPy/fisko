import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth } from '../../middleware/auth';
import * as reportsController from './reports.controller';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get('/summary', asyncHandler(reportsController.summary));
reportsRouter.get('/export', asyncHandler(reportsController.exportReport));
