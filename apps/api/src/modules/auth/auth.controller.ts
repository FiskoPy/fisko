import type { Response } from 'express';
import type { AuthedRequest } from '../../middleware/auth';
import type { Request } from 'express';
import { AppError } from '../../errors/app-error';
import {
  forgotPasswordSchema,
  googleSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.schemas';
import * as authService from './auth.service';

export async function register(req: Request, res: Response): Promise<void> {
  const input = registerSchema.parse(req.body);
  const result = await authService.register(input);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input);
  res.status(200).json(result);
}

export async function google(req: Request, res: Response): Promise<void> {
  const input = googleSchema.parse(req.body);
  const result = await authService.googleAuth(input);
  res.status(200).json(result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const input = refreshSchema.parse(req.body);
  const tokens = await authService.refresh(input);
  res.status(200).json({ tokens });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const input = forgotPasswordSchema.parse(req.body);
  await authService.forgotPassword(input);
  // Always 200 — never reveal whether the email exists.
  res.status(200).json({ ok: true });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const input = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(input);
  res.status(200).json({ ok: true });
}

export async function me(req: AuthedRequest, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const user = await authService.getMe(req.user.sub);
  res.status(200).json({ user });
}

export async function logout(req: AuthedRequest, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  await authService.logout(req.user.sub);
  res.status(200).json({ ok: true });
}
