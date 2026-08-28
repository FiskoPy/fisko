import rateLimit, { type Options } from 'express-rate-limit';

const jsonError = (code: string, message: string) => ({ error: { code, message } });

/**
 * Renders the 429 body in Spanish and says when to try again.
 *
 * `draft-7` already sends a `RateLimit` header with the reset, but nothing in
 * the app reads headers — the user only ever saw an English sentence with no
 * indication of how long to wait.
 */
/** express-rate-limit attaches this at runtime but does not augment Express's types here. */
type WithRateLimit = { rateLimit?: { resetTime?: Date } };

const limitHandler =
  (message: (minutes: number) => string): Options['handler'] =>
  (req, res) => {
    const reset = (req as unknown as WithRateLimit).rateLimit?.resetTime;
    const minutes = reset
      ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 60000))
      : 15;
    res.status(429).json(jsonError('TOO_MANY_REQUESTS', message(minutes)));
  };

/** Generous limit for general API traffic. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler((m) => `Demasiadas solicitudes. Probá de nuevo en ${m} minuto(s).`),
});

/**
 * Stricter limit for the auth endpoints (login, register, password reset).
 *
 * Keyed by IP, which in Paraguay routinely means *many* users share one key:
 * an office behind NAT, or a whole mobile carrier behind CGNAT. At the previous
 * limit of 20 per 15 minutes a handful of testers on the same connection locked
 * everyone out — including the request that would have fixed it. 60 still caps
 * a brute-force attempt at 4 tries/minute, which is the point of this limiter,
 * while leaving room for a real group of people.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler(
    (m) => `Demasiados intentos desde esta conexión. Esperá ${m} minuto(s) y probá de nuevo.`,
  ),
});
