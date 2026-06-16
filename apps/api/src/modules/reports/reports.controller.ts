import type { Response } from 'express';
import type { AuthedRequest } from '../../middleware/auth';
import { AppError } from '../../errors/app-error';
import { summaryQuerySchema, exportQuerySchema } from './reports.schemas';
import * as reportsService from './reports.service';

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
  const data = await reportsService.getSummary(userId(req), q);

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
