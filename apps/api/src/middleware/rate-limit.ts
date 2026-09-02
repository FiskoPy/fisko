import rateLimit, { type Options } from 'express-rate-limit';

import { activePlanFor, FREE_PLAN, getPlan } from '../services/plans';

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

/**
 * Per-user cap on photo OCR. Cloud Vision only exposes per-minute quotas and a
 * global one at that, so a single user could burn the whole billing account in
 * an afternoon. This is the control that actually knows who is calling.
 *
 * Counts every attempt, not just successful imports: a stream of unreadable
 * photos costs the same at Google as a stream of good ones.
 */
/**
 * Photo OCR, capped per plan.
 *
 * Vision is billed per image, so this is the one limit that maps straight to
 * the client's bill. The catalogue advertises a daily figure per tier; this
 * is what makes that figure true. Anonymous callers cannot reach here (the
 * route is behind requireAuth), so an unresolved user means something is
 * wrong: fall back to the free tier rather than the generous one.
 */
export const ocrLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: async (req) => {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    if (!sub) return getPlan(FREE_PLAN)!.ocrPerDay;
    return (await activePlanFor(sub)).ocrPerDay;
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req as { user?: { sub?: string } }).user?.sub ?? req.ip ?? "anon",
  handler: limitHandler(
    () =>
      "Llegaste al límite diario de fotos de tu plan. Probá de nuevo mañana, " +
      "importá el XML, o pasá a un plan superior.",
  ),
});
