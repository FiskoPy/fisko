import { describe, expect, it } from 'vitest';
import { calcRucDv, isValidRucDv, normalizeRuc } from '../src/utils/ruc';

describe('calcRucDv (módulo 11, base 11)', () => {
  it('returns a single digit in 0..9 for numeric input', () => {
    for (const ruc of ['80012345', '4567891', '12345678', '999999']) {
      const dv = calcRucDv(ruc);
      expect(dv).toBeGreaterThanOrEqual(0);
      expect(dv).toBeLessThanOrEqual(9);
    }
  });

  it('is deterministic and ignores non-digit separators', () => {
    expect(calcRucDv('80012345')).toBe(calcRucDv('800-123-45'));
    expect(calcRucDv('80012345')).toBe(calcRucDv('8 0 0 1 2 3 4 5'));
  });

  // Real vectors extracted from a signed SIFEN DTE (electronic invoice).
  // These are authoritative: the check digits come from the official document.
  it.each([
    ['80054993', 7], // VIELA S.A. (emisor)
    ['4904579', 2], //  receptor (persona física)
    ['80013884', 8], // BANCARD S.A.
  ])('real DNIT vector: RUC %s → dv %i', (ruc, dv) => {
    expect(calcRucDv(ruc as string)).toBe(dv);
  });
});

describe('isValidRucDv', () => {
  it('accepts a RUC paired with its computed check digit', () => {
    const ruc = '80012345';
    const dv = calcRucDv(ruc);
    expect(isValidRucDv(ruc, dv)).toBe(true);
  });

  it('accepts real DNIT RUC/dv pairs', () => {
    expect(isValidRucDv('80054993', 7)).toBe(true);
    expect(isValidRucDv('4904579', 2)).toBe(true);
    expect(isValidRucDv('80013884', 8)).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    const ruc = '80012345';
    const wrong = (calcRucDv(ruc) + 1) % 10;
    expect(isValidRucDv(ruc, wrong)).toBe(false);
  });

  it('rejects empty / non-numeric input', () => {
    expect(isValidRucDv('', 0)).toBe(false);
    expect(isValidRucDv('----', 0)).toBe(false);
  });
});

describe('normalizeRuc', () => {
  it('strips separators', () => {
    expect(normalizeRuc('800-123-45')).toBe('80012345');
    expect(normalizeRuc('80.012.345')).toBe('80012345');
  });
});
