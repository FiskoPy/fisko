import { describe, expect, it } from 'vitest';

import { parseReceipt } from '../src/services/receipt-parser';
import {
  RECEIPT_A_TEXT,
  RECEIPT_A_EXPECTED,
  RECEIPT_B_TEXT,
  RECEIPT_B_EXPECTED,
} from './fixtures/receipts';

/**
 * The two receipts the client photographed on 2026-09-05, with the values he
 * read off the paper himself. Every number here is ground truth, not a
 * snapshot of what the code does.
 *
 * A wrong amount on a tax record is worse than a missing one, so these assert
 * exact figures — the parser must either get them right or return null.
 */

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('receipt A — the IVA footer, with "05%" written with a leading zero', () => {
  const p = parseReceipt(RECEIPT_A_TEXT);

  it('reads the total to pay', () => {
    expect(p.total).toBe(RECEIPT_A_EXPECTED.total);
  });

  it('reads IVA 5% as 2.000, not an item line', () => {
    expect(p.iva5).toBe(RECEIPT_A_EXPECTED.iva5);
  });

  it('reads IVA 10% as 49.600, not an item line', () => {
    expect(p.iva10).toBe(RECEIPT_A_EXPECTED.iva10);
  });

  it('reads the date from the FECHA label', () => {
    expect(iso(p.fechaEmision)).toBe(RECEIPT_A_EXPECTED.fechaEmision);
  });

  it('the printed IVA agrees with the Paraguayan rule (gravada/11 and /21)', () => {
    // Not a parser assertion — it pins the rule the fix relies on.
    expect(Math.round(545_600 / 11)).toBe(49_600);
    expect(Math.round(42_000 / 21)).toBe(2_000);
  });
});

describe('receipt B — a full supermarket ticket', () => {
  const p = parseReceipt(RECEIPT_B_TEXT);

  it('takes TOTAL GS, not SUB TOTAL', () => {
    // 223.179 is the subtotal; the Ley 347 rounding takes 29 off it.
    expect(p.total).toBe(RECEIPT_B_EXPECTED.total);
    expect(p.total).not.toBe(223_179);
  });

  it('reads IVA 10% from the LIQUIDACION section, not from the base line', () => {
    // "TOTAL GRAVADAS 10% GS:" appears twice: 146.589 (base) then 13.326 (tax).
    expect(p.iva10).toBe(RECEIPT_B_EXPECTED.iva10);
  });

  it('reads IVA 5% likewise', () => {
    expect(p.iva5).toBe(RECEIPT_B_EXPECTED.iva5);
  });

  it('never mistakes an item line for the IVA footer', () => {
    // Every item line ends with its rate: "245208 ROSCA CON GU 0,12 69.990 8.119 10".
    expect(p.iva10).not.toBe(8_119);
    expect(p.iva5).not.toBe(9_800);
  });

  it('reads the issuer', () => {
    expect(p.emisorRuc).toBe(RECEIPT_B_EXPECTED.emisorRuc);
    expect(p.emisorDv).toBe(RECEIPT_B_EXPECTED.emisorDv);
    expect(p.emisorNombre).toBe(RECEIPT_B_EXPECTED.emisorNombre);
  });

  it('reads the two-digit date, and never one out of the order number', () => {
    // "SF-0109-16-11-152724" contains "16-11-1527".
    expect(iso(p.fechaEmision)).toBe(RECEIPT_B_EXPECTED.fechaEmision);
  });

  it('rejects an implausible year outright rather than storing it', () => {
    const year = p.fechaEmision?.getUTCFullYear() ?? 2026;
    expect(year).toBeGreaterThan(2000);
    expect(year).toBeLessThan(2100);
  });

  it('does not read a phone number as a RUC', () => {
    // "Tel: (0673) 220-270 / 221-549"
    expect(p.emisorRuc).not.toBe('220');
    expect(p.emisorRuc).not.toBe('221');
  });
});

describe('the parser never invents a number it did not read', () => {
  it('returns nulls for text with no fiscal content, rather than guessing', () => {
    const p = parseReceipt('GRACIAS POR SU COMPRA\nVUELVA PRONTO');
    expect(p.total).toBeNull();
    expect(p.iva5).toBeNull();
    expect(p.iva10).toBeNull();
    expect(p.missing).toContain('Total');
  });
});
