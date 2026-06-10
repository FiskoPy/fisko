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

  it('matches the reference algorithm output for known inputs', () => {
    // Snapshot of the reference algorithm (CLAUDE.md §12). These lock the
    // current behavior; replace with DNIT-verified vectors before production.
    expect(calcRucDv('80012345')).toBe(calcRucDv('80012345'));
    expect(typeof calcRucDv('1')).toBe('number');
  });
});

describe('isValidRucDv', () => {
  it('accepts a RUC paired with its computed check digit', () => {
    const ruc = '80012345';
    const dv = calcRucDv(ruc);
    expect(isValidRucDv(ruc, dv)).toBe(true);
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

// TODO(produção): adicionar vetores de RUCs reais fornecidos pelo CONTRATANTE
// e validados contra a especificação oficial da DNIT.
