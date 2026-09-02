import type { Response } from 'express';
import type { AuthedRequest } from '../../middleware/auth';
import { AppError } from '../../errors/app-error';
import { summaryQuerySchema, exportQuerySchema } from './reports.schemas';
import * as reportsService from './reports.service';
import { prisma } from '../../lib/prisma';
import { activePlanFor, canExportReports } from '../../services/plans';

function userId(req: AuthedRequest): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.sub;
}

export async function summary(req: AuthedRequest, res: Response): Promise<void> {
  const q = summaryQuerySchema.parse(req.query);
  const data = await reportsService.getSummary(userId(req), q);
  res.status(200).json(data);
}

export async function exportReport(req: AuthedRequest, res: Response): Promise<void> {
  const q = exportQuerySchema.parse(req.query);
  const uid = userId(req);

  // The plan tiers are by invoice volume, and the limit gates the OUTPUT (the
  // PDF/Excel), never the capture: losing a fiscal record to a billing tier
  // would be our fault with the DNIT. See canExportReports.
  const plan = await activePlanFor(uid);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const thisMonth = await prisma.invoice.count({
    where: { userId: uid, createdAt: { gte: monthStart } },
  });
  if (!canExportReports(plan, thisMonth)) {
    throw new AppError(
      402,
      'PLAN_LIMIT',
      `Tu plan ${plan.name} incluye hasta ${plan.invoiceLimit} facturas por mes y este mes ` +
        `ya cargaste ${thisMonth}. Pasá a un plan superior para exportar el reporte.`,
      { planId: plan.id, invoiceLimit: plan.invoiceLimit, invoicesThisMonth: thisMonth },
    );
  }

  const data = await reportsService.getSummary(uid, q);

  if (q.format === 'excel') {
    const buf = await reportsService.buildExcel(data);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="fisko-reporte.xlsx"');
    res.status(200).send(buf);
    return;
  }

  const buf = await reportsService.buildPdf(data);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="fisko-reporte.pdf"');
  res.status(200).send(buf);
}
