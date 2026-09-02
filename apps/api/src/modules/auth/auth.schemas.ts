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

/**
 * Setting the RUC after registration.
 *
 * It is optional at sign-up, but a user without one has every invoice counted
 * as a purchase (getSummary decides ventas vs compras by comparing the
 * emisor's RUC with the user's), so ventas and IVA débito stay at zero for
 * good. There was no way to add it later; this is that way.
 */
export const updateProfileSchema = z.object({
  ruc: z.string().trim().regex(/^\d{3,12}$/, 'El RUC debe tener sólo dígitos'),
  rucDv: z.coerce.number().int().min(0).max(9),
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

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
