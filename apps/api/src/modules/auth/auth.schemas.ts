import { z } from 'zod';

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const email = z.string().email().toLowerCase().trim();

export const registerSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  email,
  password,
  // RUC base digits (without the check digit). Optional at registration.
  ruc: z
    .string()
    .trim()
    .regex(/^\d{3,12}$/, 'RUC must contain only digits')
    .optional(),
  // Check digit (dDVEmi). Required when ruc is provided.
  rucDv: z.coerce.number().int().min(0).max(9).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1),
});

export const googleSchema = z.object({
  idToken: z.string().min(10),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const forgotPasswordSchema = z.object({
  email,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: password,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleInput = z.infer<typeof googleSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
