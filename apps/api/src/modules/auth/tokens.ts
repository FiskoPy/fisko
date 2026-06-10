import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
}

export interface RefreshTokenPayload {
  sub: string; // user id
  tokenVersion: number; // must match User.tokenVersion to be valid
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  } as SignOptions);
}

export function issueTokenPair(user: {
  id: string;
  email: string;
  tokenVersion: number;
}): TokenPair {
  return {
    accessToken: signAccessToken({ sub: user.id, email: user.email }),
    refreshToken: signRefreshToken({ sub: user.id, tokenVersion: user.tokenVersion }),
  };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    throw AppError.unauthorized('Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }
}
