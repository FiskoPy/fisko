import { describe, it, expect } from 'vitest';
import { categorize, categoryLabel, normalizeText, CATEGORIES } from '../src/services/categories';

describe('normalizeText', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeText('TELEFONÍA MÓVIL')).toBe('telefonia movil');
    expect(normalizeText('Alimentación')).toBe('alimentacion');
    expect(normalizeText('CLÍNICA')).toBe('clinica');
  });
});

describe('categorize — by issuer name', () => {
  const cases: Array<[string, string]> = [
    ['PETROBRAS PARAGUAY DISTRIBUCION LIMITED', 'combustible'],
    ['COPETROL S.A.', 'combustible'],
    ['PUMA ENERGY PARAGUAY S.A.', 'combustible'],
    ['ANDE - ADMINISTRACION NACIONAL DE ELECTRICIDAD', 'servicios_basicos'],
    ['ESSAP S.A.', 'servicios_basicos'],
    ['TELECEL S.A. (TIGO)', 'telecomunicaciones'],
    ['NUCLEO S.A. PERSONAL', 'telecomunicaciones'],
    ['COPACO S.A.', 'telecomunicaciones'],
    ['SUDAMERIS BANK SAECA', 'financiero'],
    ['BANCO ITAU PARAGUAY S.A.', 'financiero'],
    ['SUPERSEIS S.A.', 'alimentacion'],
    ['BIGGIE EXPRESS S.A.', 'alimentacion'],
    ['FARMACENTER S.A.', 'salud'],
    ['PUNTO FARMA S.A.', 'salud'],
    ['MICROSOFT CORPORATION', 'tecnologia'],
    ['UNIVERSIDAD NACIONAL DE ASUNCION', 'educacion'],
  ];

  for (const [issuer, expected] of cases) {
    it(`${issuer} -> ${expected}`, () => {
      expect(categorize(issuer, [])).toBe(expected);
    });
  }
});

describe('categorize — falls back to item descriptions', () => {
  it('uses items when the issuer name says nothing', () => {
    expect(categorize('COMERCIAL XYZ S.A.', ['NAFTA SUPER 95', 'LUBRICANTE'])).toBe('combustible');
    expect(categorize('DISTRIBUIDORA ACME', ['Alquiler de local comercial'])).toBe('alquiler');
    expect(categorize('SERVICIOS SRL', ['Licencia de software anual'])).toBe('tecnologia');
  });

  it('prefers the issuer over the items', () => {
    // A fuel station selling a sandwich is still fuel spending.
    expect(categorize('PETROBRAS PARAGUAY', ['SANDWICH', 'GASEOSA'])).toBe('combustible');
  });
});

describe('categorize — unknown input', () => {
  it('returns otros when nothing matches', () => {
    expect(categorize('EMPRESA DESCONOCIDA S.A.', ['Producto genérico'])).toBe('otros');
    expect(categorize('', [])).toBe('otros');
  });

  it('labels otros', () => {
    expect(categoryLabel('otros')).toBe('Otros');
  });
});

describe('category definitions', () => {
  it('every category has a non-empty label and at least one pattern', () => {
    for (const c of CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.patterns.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate keys', () => {
    const keys = CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('patterns are accent-free, since input is normalized before matching', () => {
    // A pattern containing "é" could never match normalized text ("e").
    for (const c of CATEGORIES) {
      for (const re of c.patterns) {
        expect(re.source, `${c.key}: ${re.source}`).toBe(normalizeText(re.source));
      }
    }
  });
});
