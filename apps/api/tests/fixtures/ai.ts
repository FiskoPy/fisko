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
 * vision/rrtop-usd-kude). The model's mistakes are kept — they are the point:
 *  - usd-rrtop: issuer and buyer swapped (the CDC says who issued it);
 *  - baratao: the IVA written into gravada10;
 *  - ecop-exenta: a RUC with a wrong check digit, and a 40-digit CDC;
 *  - minas281: a street address as the issuer's name;
 *  - primavera: 16 items that do not add up to the total.
 */
export type AiFixture = 'minas281' | 'fox-kude' | 'primavera' | 'ecop-exenta' | 'baratao' | 'usd-rrtop';

export function aiFixture(name: AiFixture): Extraction {
  return JSON.parse(readFileSync(join(__dirname, 'ai', `${name}.json`), 'utf8')) as Extraction;
}
