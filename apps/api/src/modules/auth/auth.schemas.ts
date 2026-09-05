import { z } from 'zod';

/**
 * Passwords are compared byte-for-byte by argon2, but the same visible text can
 * arrive in two different encodings: "Contraseña" is 15 code units in NFC and
 * 16 in NFD, depending on the keyboard/IME. Proven live: a password registered
 * in NFC was rejected when typed again in NFD. Normalising both sides to NFC
 * makes what the user sees the thing that is compared.
 */
const password = z
  .string()
  .transform((s) => s.normalize('NFC'))
  .pipe(
    z
      .string()
      .min(8, 'La contraseña tiene que tener al menos 8 caracteres.')
      .max(128, 'La contraseña no puede tener más de 128 caracteres.'),
  );

/** Trim BEFORE validating, or a pasted address with a stray space just fails. */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().email({ message: 'Ese correo no parece válido. Revisalo.' }));

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Escribí tu nombre.').max(120),
  email,
  password,
  // RUC base digits (without the check digit). Optional at registration.
  ruc: z
    .string()
    .trim()
    .regex(/^\d{3,12}$/, 'El RUC tiene que tener sólo números, sin puntos ni guiones.')
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
  // Same NFC normalisation as registration — without it the login side would
  // still hash a different byte sequence for the same visible password. No
  // length rule here: on login the stored password is whatever it is.
  password: z
    .string()
    .min(1, 'Escribí tu contraseña.')
    .transform((s) => s.normalize('NFC')),
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
  // The code is pasted from WhatsApp, which loves adding whitespace.
  token: z.string().trim().min(10, 'Pegá el código completo.'),
  newPassword: password,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleInput = z.infer<typeof googleSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
