import type { Request, RequestHandler } from 'express';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/async-handler';
import { verifyAccessToken, type AccessTokenPayload } from '../modules/auth/tokens';

export interface AuthedRequest extends Request {
  user?: AccessTokenPayload;
}

/**
 * Requires a valid Bearer access token and a user that still exists; attaches
 * the payload to req.user.
 *
 * The existence check is not redundant with signature verification. Access
 * tokens are stateless and live for 15 minutes, so after an account is deleted
 * its token stays cryptographically valid for the rest of that window. Reads
 * then returned empty 200s and writes blew up as 500s on the foreign key
 * (import-xml and logout both did). One primary-key lookup turns that into a
 * clean 401.
 */
export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw AppError.unauthorized('Missing Bearer token');
  }

  const payload = verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true },
  });
  if (!user) {
    throw AppError.unauthorized('La cuenta ya no existe');
  }

  (req as AuthedRequest).user = payload;
  next();
});
