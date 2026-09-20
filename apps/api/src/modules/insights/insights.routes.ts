import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';
import { documentSign, getSummary } from '../reports/reports.service';
import { buildInsights } from '../../services/fiscal-insights';
import { forecastIva } from '../../services/fiscal-forecast';

/** Marco 2 phase 2E — fiscal insights (rules) plus the IVA projection. */
export const insightsRouter = Router();

insightsRouter.use(requireAuth);

const RECENT_WINDOW_DAYS = 10;

/** The period the app is looking at, by the date printed on the invoice. */
const periodQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

insightsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) throw AppError.unauthorized();

    // The screen that shows these picks a month, and everything it shows has
    // to be about that month — the client read a figure of August as his
    // September spending (2026-09-20). The 10-day card stays about what was
    // loaded, which is the one thing here that is not about the period.
    const period = periodQuerySchema.parse(req.query);
    const now = new Date();
    const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * 86_400_000);

    const [summary, latest, recent, owner] = await Promise.all([
      getSummary(user.sub, period),
      // When the newest invoice ENTERED Fisko, not its emission date: the nudge
      // says "hace N días que no entra una factura", and a February invoice
      // imported today used to make it say 199 days one second after import.
      prisma.invoice.findFirst({
        where: { userId: user.sub },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.invoice.findMany({
        where: { userId: user.sub, createdAt: { gte: since } },
        select: { totalOpe: true, moneda: true, tipoCambio: true, tipoDoc: true },
      }),
      // The RUC sets the day the IVA is filed (DNIT's perpetual calendar).
      prisma.user.findUnique({ where: { id: user.sub }, select: { ruc: true } }),
    ]);

    // Same currency rule as the summary: convert with the invoice's own rate,
    // and leave out anything we cannot convert rather than adding USD to PYG.
    // A nota de remisión carries no operation of its own, so it is counted as
    // a document but never as a comprobante that moves a total.
    let recentTotal = 0;
    let recentCount = 0;
    for (const r of recent) {
      const rate = r.moneda === 'PYG' ? 1 : Number(r.tipoCambio ?? 0);
      if (!rate || documentSign(r.tipoDoc) === 0) continue;
      recentTotal += Number(r.totalOpe) * rate;
      recentCount += 1;
    }

    const insights = buildInsights({
      summary,
      lastInvoiceAt: latest?.createdAt ?? null,
      ruc: owner?.ruc ?? null,
      recentCount,
      recentDocs: recent.length,
      recentTotal,
      now,
    });

    const forecast = await forecastIva(summary.byMonth, now);

    res.status(200).json({ insights, forecast });
  }),
);
