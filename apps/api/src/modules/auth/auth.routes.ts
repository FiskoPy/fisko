import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rate-limit';
import * as authController from './auth.controller';

export const authRouter = Router();

// Sensitive endpoints get the stricter rate limiter.
authRouter.post('/register', authLimiter, asyncHandler(authController.register));
authRouter.post('/login', authLimiter, asyncHandler(authController.login));
authRouter.post('/google', authLimiter, asyncHandler(authController.google));
authRouter.post('/refresh', asyncHandler(authController.refresh));
authRouter.post('/forgot-password', authLimiter, asyncHandler(authController.forgotPassword));
authRouter.post('/reset-password', authLimiter, asyncHandler(authController.resetPassword));

authRouter.get('/me', requireAuth, asyncHandler(authController.me));
authRouter.post('/logout', requireAuth, asyncHandler(authController.logout));
