import type { Request, RequestHandler } from 'express';
import { AppError } from '../errors/app-error';
import { verifyAccessToken, type AccessTokenPayload } from '../modules/auth/tokens';

export interface AuthedRequest extends Request {
  user?: AccessTokenPayload;
}

/** Requires a valid Bearer access token; attaches the payload to req.user. */
export const requireAuth: RequestHandler = (req: AuthedRequest, _res, next) => {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw AppError.unauthorized('Missing Bearer token');
  }

  req.user = verifyAccessToken(token);
  next();
};
