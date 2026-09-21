import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Extraction } from '../../src/services/receipt-parser';

/**
 * What gpt-4.1-mini really answered, through ai-reader's schema and
 * instructions, for the client's photos (2026-09-19) — the same photos as
 * tests/fixtures/vision, plus two with no Vision fixture here.
 *
 * Masked as the Vision fixtures are: the buyer's name (X) and CI (1111111),
 * and a CDC's security code (check digit recomputed; the USD one matches
 * vision/rrtop-usd-kude).
 *
 * These are answers to the instructions as they stood that day. The baratao
 * one is why they were tightened afterwards (ai-reader: the columns headed
 * 5% / 10% beside the items are gravadas, not the tax) — asked again since,
 * the model reads that talonario right. They are kept as they were: a reading
 * that is wrong in a way that adds up is exactly what the checks are for.
 *
 * The model's mistakes are kept — they are the point:
 *  - usd-rrtop: issuer and buyer swapped (the CDC says who issued it);
 *  - baratao: the IVA written into gravada10;
 *  - ecop-exenta: a RUC with a wrong check digit, and a 40-digit CDC;
 *  - minas281: a street address as the issuer's name;
 *  - primavera: 16 items that do not add up to the total.
 *
 * Two more from 2026-09-21, the handwritten talonarios of ocr-text (the
 * landlord's name masked there; the buyer is the client's own company):
 *  - domicia-usd: a dollar rent receipt read as guaraníes, with an IVA of
 *    45,45 — the tick in "Son: ☐ Guaraníes ☒ Dólares" missed;
 *  - cevelio-manuscrita: read right, in guaraníes.
 */
export type AiFixture =
  | 'minas281'
  | 'fox-kude'
  | 'primavera'
  | 'ecop-exenta'
  | 'baratao'
  | 'usd-rrtop'
  | 'domicia-usd'
  | 'cevelio-manuscrita';

export function aiFixture(name: AiFixture): Extraction {
  return JSON.parse(readFileSync(join(__dirname, 'ai', `${name}.json`), 'utf8')) as Extraction;
}
