import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import { logger } from '../../lib/logger';
import { asyncHandler } from '../../utils/async-handler';
import { authLimiter } from '../../middleware/rate-limit';
import { issuePasswordResetCode } from '../auth/auth.service';

/**
 * Operator-only escape hatch, mounted only when ADMIN_TOKEN is set.
 *
 * Exists because the homologation server has no outbound mail: a user who
 * forgets their password is locked out with no recovery path, and the DB
 * allow-list plus paid one-off jobs mean an operator cannot mint a code from
 * outside either. This lets support hand the user the same code the email
 * would have carried. It should become unnecessary once Brevo is configured —
 * simply unset ADMIN_TOKEN and the router is never mounted.
 */
export const adminRouter = Router();

function requireAdmin(req: Request, _res: Response, next: () => void): void {
  const expected = env.ADMIN_TOKEN;
  const given = req.header('x-admin-token') ?? '';
  // Compare in constant time; lengths differ → also reject without timing leak.
  const ok =
    expected !== undefined &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) throw AppError.unauthorized();
  next();
}

const bodySchema = z.object({ email: z.string().email() });

adminRouter.post(
  '/password-reset-code',
  authLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { email } = bodySchema.parse(req.body);
    const out = await issuePasswordResetCode(email);
    logger.warn({ email, ip: req.ip }, 'admin: password reset code issued manually');
    res.status(200).json(out);
  }),
);
