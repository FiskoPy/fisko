import { z } from 'zod';

export const summaryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const exportQuerySchema = summaryQuerySchema.extend({
  format: z.enum(['pdf', 'excel']).default('pdf'),
});

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
