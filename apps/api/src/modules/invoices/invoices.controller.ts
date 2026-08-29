import type { Request, Response } from 'express';
import type { AuthedRequest } from '../../middleware/auth';
import { AppError } from '../../errors/app-error';
import { importPhotoSchema, importXmlSchema, listInvoicesQuerySchema } from './invoices.schemas';
import * as invoicesService from './invoices.service';

function userId(req: AuthedRequest): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.sub;
}

export async function importXml(req: AuthedRequest, res: Response): Promise<void> {
  const { xml } = importXmlSchema.parse(req.body);
  const invoice = await invoicesService.importXml(userId(req), xml);
  res.status(201).json({ invoice });
}

export async function importPhoto(req: AuthedRequest, res: Response): Promise<void> {
  const { imageBase64 } = importPhotoSchema.parse(req.body);
  const out = await invoicesService.importPhoto(userId(req), imageBase64);
  res.status(201).json(out);
}

export async function list(req: AuthedRequest, res: Response): Promise<void> {
  const q = listInvoicesQuerySchema.parse(req.query);
  const result = await invoicesService.listInvoices(userId(req), q);
  res.status(200).json(result);
}

export async function detail(req: AuthedRequest, res: Response): Promise<void> {
  const invoice = await invoicesService.getInvoice(userId(req), (req as Request).params.id as string);
  res.status(200).json({ invoice });
}

export async function remove(req: AuthedRequest, res: Response): Promise<void> {
  await invoicesService.deleteInvoice(userId(req), (req as Request).params.id as string);
  res.status(200).json({ ok: true });
}
