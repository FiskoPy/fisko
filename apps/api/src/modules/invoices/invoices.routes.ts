import express, { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { ocrLimiter } from '../../middleware/rate-limit';
import { requireAuth } from '../../middleware/auth';
import * as invoicesController from './invoices.controller';

export const invoicesRouter = Router();

/**
 * A photographed invoice arrives as base64 and easily exceeds the app-wide
 * 100kb JSON limit, which would reject it before any handler ran. The larger
 * limit is scoped to this one route so the rest of the API keeps the tight
 * default; ocr.ts enforces the real size cap (MAX_IMAGE_BYTES) after parsing.
 */
const photoBodyLimit = express.json({ limit: '12mb' });

invoicesRouter.use(requireAuth);

invoicesRouter.post('/import-xml', asyncHandler(invoicesController.importXml));
invoicesRouter.post('/import-photo', ocrLimiter, photoBodyLimit, asyncHandler(invoicesController.importPhoto));
invoicesRouter.get('/', asyncHandler(invoicesController.list));
invoicesRouter.get('/:id', asyncHandler(invoicesController.detail));
invoicesRouter.delete('/:id', asyncHandler(invoicesController.remove));
