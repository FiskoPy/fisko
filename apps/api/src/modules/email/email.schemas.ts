import { z } from 'zod';

export const connectEmailSchema = z
  .object({
    provider: z.enum(['gmail', 'outlook', 'imap']),
    email: z.string().email(),
    // App password (Gmail) or IMAP password. For 'imap' provider host/port required.
    appPassword: z.string().min(4, 'Contraseña de aplicación requerida'),
    host: z.string().min(1).optional(),
    port: z.coerce.number().int().positive().optional(),
    secure: z.coerce.boolean().optional(),
  })
  .refine((v) => v.provider !== 'imap' || (!!v.host && !!v.port), {
    message: 'host y port son obligatorios para el proveedor imap',
    path: ['host'],
  });

export const syncEmailSchema = z.object({
  sinceDays: z.coerce.number().int().min(1).max(365).optional(),
});

export type ConnectEmailInput = z.infer<typeof connectEmailSchema>;
export type SyncEmailInput = z.infer<typeof syncEmailSchema>;
