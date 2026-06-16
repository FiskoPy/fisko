import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth } from '../../middleware/auth';
import * as invoicesController from './invoices.controller';

export const invoicesRouter = Router();

invoicesRouter.use(requireAuth);

invoicesRouter.post('/import-xml', asyncHandler(invoicesController.importXml));
invoicesRouter.get('/', asyncHandler(invoicesController.list));
invoicesRouter.get('/:id', asyncHandler(invoicesController.detail));
invoicesRouter.delete('/:id', asyncHandler(invoicesController.remove));
