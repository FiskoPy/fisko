import { z } from 'zod';

import { env } from '../config/env';
import { logger } from '../lib/logger';
import type { Extraction } from './receipt-parser';

/**
 * A second reader for invoice photos: a vision-language model reads the whole
 * image and returns the fiscal fields and the line items.
 *
 * It reads layouts the OCR-and-rules reader does not — the client's own
 * prototype did, and on his six real photos it had every total and IVA right,
 * dollars and exchange rate included. But it also swapped issuer and buyer on
 * one, put the IVA in the gravada field on another and misread a RUC on a
 * third, and a language model can write a plausible number that is not on
 * the paper. So nothing it returns is stored on its word: fromExtraction
 * holds it to the same arithmetic as the parser, and decidePhoto weighs the
 * two readings.
 *
 * Returns null — and the photo is read by the parser alone — when the feature
 * is off, no key is set, or the call fails in any way.
 */

const MODEL = 'gpt-4.1-mini';
// The app waits 60s for the whole import, and a cold start can eat much of
// that; past this the photo is the parser's alone rather than a failed upload.
const TIMEOUT_MS = 20_000;

const num = { type: ['number', 'null'] };
const text = { type: ['string', 'null'] };

/** The answer's shape, enforced by the API (strict structured output). */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    emisorNombre: text,
    emisorRuc: text,
    emisorDv: { type: ['integer', 'null'] },
    receptorNombre: text,
    receptorRuc: text,
    timbrado: text,
    numeroDoc: text,
    fecha: text,
    tipoDocumento: { type: 'string', enum: ['factura', 'nota_credito', 'nota_debito', 'otro'] },
    moneda: { type: 'string', enum: ['PYG', 'USD', 'BRL', 'EUR', 'OTRA'] },
    tipoCambio: num,
    totalEnGuaranies: num,
    total: num,
    gravada5: num,
    gravada10: num,
    exentas: num,
    iva5: num,
    iva10: num,
    totalIva: num,
    redondeo: num,
    cdc: text,
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          descripcion: { type: 'string' },
          cantidad: num,
          precioUnitario: num,
          total: num,
          tasaIva: { type: ['integer', 'null'] },
        },
        required: ['descripcion', 'cantidad', 'precioUnitario', 'total', 'tasaIva'],
      },
    },
  },
  required: [
    'emisorNombre', 'emisorRuc', 'emisorDv', 'receptorNombre', 'receptorRuc', 'timbrado',
    'numeroDoc', 'fecha', 'tipoDocumento', 'moneda', 'tipoCambio', 'totalEnGuaranies', 'total',
    'gravada5', 'gravada10', 'exentas', 'iva5', 'iva10', 'totalIva', 'redondeo', 'cdc', 'items',
  ],
} as const;

const INSTRUCTIONS =
  'You read a photographed Paraguayan invoice (factura, KuDE or till receipt) and return only what ' +
  'is printed. If a value is not legible or not printed, return null — never compute or guess a ' +
  "value that is not on the paper. Amounts are numbers in the invoice's own currency: Paraguayan " +
  "'1.538,00' is 1538.00 and '223.150' Gs is 223150. gravada5 / gravada10 are the taxed sales " +
  'amounts as printed per rate, IVA included (columns 5% / 10%, "Total gravadas", "Gravadas 10%"). ' +
  'iva5 / iva10 are the printed IVA liquidation per rate; totalIva the printed IVA total. exentas ' +
  'is the exempt amount. total is the amount to pay in the invoice currency. redondeo is a printed ' +
  'Ley 347 rounding. moneda: PYG unless the invoice states another currency (e.g. "dolares ' +
  'americanos", "Moneda: USD"). tipoCambio: the printed exchange rate ("Cotizacion", "Tipo de ' +
  'cambio") in guaranies per unit, else null. totalEnGuaranies: a printed total in guaranies when ' +
  'the invoice is in another currency, else null. emisor is the seller that issued the invoice ' +
  '(its RUC is printed next to the timbrado); receptor is the buyer. RUC: the digits before the ' +
  'hyphen in emisorRuc / receptorRuc, the check digit in emisorDv. numeroDoc as printed, like ' +
  '001-001-0000637. fecha: the issue date as YYYY-MM-DD. cdc: the 44-digit CDC exactly as ' +
  'printed, digits only, else null. items: every line item printed, with its IVA rate (0, 5 or 10).';

const nullableNumber = z.number().nullable();
const answerSchema = z.object({
  emisorNombre: z.string().nullable(),
  emisorRuc: z.string().nullable(),
  emisorDv: z.number().int().nullable(),
  receptorNombre: z.string().nullable(),
  receptorRuc: z.string().nullable(),
  timbrado: z.string().nullable(),
  numeroDoc: z.string().nullable(),
  fecha: z.string().nullable(),
  tipoDocumento: z.enum(['factura', 'nota_credito', 'nota_debito', 'otro']),
  moneda: z.enum(['PYG', 'USD', 'BRL', 'EUR', 'OTRA']),
  tipoCambio: nullableNumber,
  totalEnGuaranies: nullableNumber,
  total: nullableNumber,
  gravada5: nullableNumber,
  gravada10: nullableNumber,
  exentas: nullableNumber,
  iva5: nullableNumber,
  iva10: nullableNumber,
  totalIva: nullableNumber,
  redondeo: nullableNumber,
  cdc: z.string().nullable(),
  items: z
    .array(
      z.object({
        descripcion: z.string(),
        cantidad: nullableNumber,
        precioUnitario: nullableNumber,
        total: nullableNumber,
        tasaIva: z.number().int().nullable(),
      }),
    )
    .max(300),
});

/** The image type, from the first bytes of its base64 (the app sends JPEG). */
function mimeOf(imageBase64: string): string {
  if (imageBase64.startsWith('iVBOR')) return 'image/png';
  if (imageBase64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

export function isAiReaderEnabled(): boolean {
  return env.OCR_AI !== 'off' && Boolean(env.OPENAI_API_KEY);
}

export async function readInvoiceWithAI(imageBase64: string): Promise<Extraction | null> {
  if (!isAiReaderEnabled()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'invoice', strict: true, schema: SCHEMA },
        },
        messages: [
          { role: 'system', content: INSTRUCTIONS },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mimeOf(imageBase64)};base64,${imageBase64}`, detail: 'high' },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'AI reader: OpenAI rejected the request');
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = answerSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues.length }, 'AI reader: answer out of shape');
      return null;
    }
    return parsed.data;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'AI reader: call failed, parser reads alone');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
