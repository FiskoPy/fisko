import { describe, expect, it } from 'vitest';

import { layoutSkeleton } from '../src/services/receipt-parser';
import { RECEIPT_B_TEXT } from './fixtures/receipts';

/**
 * When a photo fails to parse, the server logs the text's LAYOUT so the
 * failure can be diagnosed. Receipt B carries a real buyer's name and CI —
 * "Nombre: ALBERTO VELAZQUEZ", "CIoRUC: 4904579-2" — which makes it the right
 * fixture to prove that nothing personal survives into the log.
 */
describe('layoutSkeleton — what reaches the logs', () => {
  const s = layoutSkeleton(RECEIPT_B_TEXT);

  it('contains no real digit — every one becomes 9', () => {
    expect(s).not.toMatch(/[0-8]/);
  });

  it("does not carry the buyer's name or CI", () => {
    expect(s).not.toMatch(/alberto|velazquez/i);
    expect(s).not.toContain('4904579');
  });

  it("does not carry the merchant's name or RUC either", () => {
    expect(s).not.toMatch(/primavera/i);
    expect(s).not.toContain('80036323');
  });

  it('keeps the fiscal labels and number shapes, which is what a diagnosis needs', () => {
    expect(s).toContain('total gs: 999.999');
    expect(s).toContain('liquidacion iva');
    expect(s).toMatch(/total gravadas 99% gs:\s+999\.999/);
  });

  it('keeps the line structure, so a label/value split stays visible', () => {
    expect(s.split('\n')).toHaveLength(RECEIPT_B_TEXT.split('\n').length);
  });

  it('masks accented names whole, not just their ASCII letters', () => {
    expect(layoutSkeleton('Nombre: JOSÉ NÚÑEZ')).toBe('nombre: w w');
  });

  it('is bounded in size', () => {
    expect(layoutSkeleton('TOTAL 1.000\n'.repeat(1000)).length).toBeLessThanOrEqual(1500);
  });
});
