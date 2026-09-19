import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VisionAnnotation } from '../../src/services/vision-layout';

/**
 * What Cloud Vision really returned for tickets the client photographed on
 * 2026-09-15 — DOCUMENT_TEXT_DETECTION, the call production makes — trimmed to
 * the text, the word boxes and the symbol breaks this code reads.
 *
 * Personal data is masked in place: the buyer's and the cashier's names letter
 * for letter (X), the buyer's CI digit for digit (1111111-9, a valid pair),
 * and the two lookup keys that retrieve the buyer's own invoice — the KuDE's
 * CDC security code (check digit recomputed) and the shop's order number.
 * Every box and every symbol count is as Vision returned it. Merchants'
 * details are public and stay.
 *
 *  - primavera-ticket: stored as Gs 29 instead of Gs 223.150.
 *  - fox-kude: a KuDE. Production read another photo of it as Gs 8.000 with no
 *    IVA; in this one Vision spelled the total label "Tolal".
 *  - minas281-ticket, minas281-ticket-retake: the one that came out right.
 *  - baratao-talonario: a pre-printed form (scanned, 2026-09-17) whose amounts
 *    sit above their labels; refused for "no IVA" on 2026-09-19.
 */
export type VisionFixture =
  | 'primavera-ticket'
  | 'fox-kude'
  | 'minas281-ticket'
  | 'minas281-ticket-retake'
  | 'baratao-talonario';

export function visionFixture(name: VisionFixture): VisionAnnotation {
  return JSON.parse(readFileSync(join(__dirname, 'vision', `${name}.json`), 'utf8')) as VisionAnnotation;
}
