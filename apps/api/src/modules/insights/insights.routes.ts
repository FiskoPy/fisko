import { Router } from 'express';
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

insightsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) throw AppError.unauthorized();

    const now = new Date();
    const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * 86_400_000);

    const [summary, latest, recent, owner] = await Promise.all([
      getSummary(user.sub, {}),
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
