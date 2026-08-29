import { z } from 'zod';

export const importXmlSchema = z.object({
  xml: z.string().min(20, 'XML vacío o inválido'),
});

export const importPhotoSchema = z.object({
  /** Base64 of the photo, without the data: URI prefix. */
  imageBase64: z.string().min(100, 'Imagen vacía'),
});

export const listInvoicesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  tipoDoc: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ImportXmlInput = z.infer<typeof importXmlSchema>;
export type ImportPhotoInput = z.infer<typeof importPhotoSchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
