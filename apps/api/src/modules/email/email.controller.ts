import type { Request, Response } from 'express';
import type { AuthedRequest } from '../../middleware/auth';
import { AppError } from '../../errors/app-error';
import { connectEmailSchema, syncEmailSchema } from './email.schemas';
import * as emailService from './email.service';

function userId(req: AuthedRequest): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.sub;
}

export async function connect(req: AuthedRequest, res: Response): Promise<void> {
  const input = connectEmailSchema.parse(req.body);
  const connection = await emailService.connectEmail(userId(req), input);
  res.status(201).json({ connection });
}

export async function status(req: AuthedRequest, res: Response): Promise<void> {
  const connections = await emailService.listConnections(userId(req));
  res.status(200).json({ connections });
}

export async function sync(req: AuthedRequest, res: Response): Promise<void> {
  const { sinceDays } = syncEmailSchema.parse(req.body ?? {});
  const id = (req as Request).params.id as string;
  const out = await emailService.syncEmail(userId(req), id, sinceDays);
  res.status(200).json(out);
}

export async function disconnect(req: AuthedRequest, res: Response): Promise<void> {
  await emailService.disconnectEmail(userId(req), (req as Request).params.id as string);
  res.status(200).json({ ok: true });
}
