import rateLimit from 'express-rate-limit';

const jsonError = (code: string, message: string) => ({ error: { code, message } });

/** Generous limit for general API traffic. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonError('TOO_MANY_REQUESTS', 'Too many requests, please try again later'),
});

/** Stricter limit for sensitive auth endpoints (login, register, password reset). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonError('TOO_MANY_REQUESTS', 'Too many attempts, please try again later'),
});
