import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth } from '../../middleware/auth';
import * as emailController from './email.controller';

export const emailRouter = Router();

emailRouter.use(requireAuth);

emailRouter.post('/connect', asyncHandler(emailController.connect));
emailRouter.get('/status', asyncHandler(emailController.status));
emailRouter.post('/:id/sync', asyncHandler(emailController.sync));
emailRouter.delete('/:id', asyncHandler(emailController.disconnect));
