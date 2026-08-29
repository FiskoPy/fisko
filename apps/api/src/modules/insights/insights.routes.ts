import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';
import { getSummary } from '../reports/reports.service';
import { buildInsights } from '../../services/fiscal-insights';
import { forecastIva } from '../../services/fiscal-forecast';

/** Marco 2 phase 2E — fiscal insights (rules) plus the IVA projection. */
export const insightsRouter = Router();

insightsRouter.use(requireAuth);

const RECENT_WINDOW_DAYS = 10;

insightsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) throw AppError.unauthorized();

    const now = new Date();
    const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * 86_400_000);

    const [summary, latest, recent] = await Promise.all([
      getSummary(user.sub, {}),
      prisma.invoice.findFirst({
        where: { userId: user.sub },
        orderBy: { fechaEmision: 'desc' },
        select: { fechaEmision: true },
      }),
      prisma.invoice.findMany({
        where: { userId: user.sub, createdAt: { gte: since } },
        select: { totalOpe: true, moneda: true, tipoCambio: true },
      }),
    ]);

    // Same currency rule as the summary: convert with the invoice's own rate,
    // and leave out anything we cannot convert rather than adding USD to PYG.
    let recentTotal = 0;
    let recentCount = 0;
    for (const r of recent) {
      const rate = r.moneda === 'PYG' ? 1 : Number(r.tipoCambio ?? 0);
      if (!rate) continue;
      recentTotal += Number(r.totalOpe) * rate;
      recentCount += 1;
    }

    const insights = buildInsights({
      summary,
      lastInvoiceAt: latest?.fechaEmision ?? null,
      recentCount,
      recentTotal,
      now,
    });

    const forecast = await forecastIva(summary.byMonth, now);

    res.status(200).json({ insights, forecast });
  }),
);
