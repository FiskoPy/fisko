import { describe, expect, it } from 'vitest';

import { CATEGORIES, categorize, normalizeText } from '../src/services/categories';

/**
 * The client photographed a SUPER PRIMAVERA ticket and it landed in "Otros
 * gastos". Two things were wrong: no pattern matched that name, and the whole
 * idea of folding supermarkets into Alimentación makes the commonest expense
 * in the country invisible.
 *
 * An invoice imported from a photo carries NO line items, so the issuer's name
 * is the only signal there is. That makes the order of CATEGORIES the entire
 * classification, and it is why the false-positive cases below matter as much
 * as the positive ones.
 */

describe('supermarkets are their own category', () => {
  it('classifies the ticket the client photographed', () => {
    expect(categorize('SUPER PRIMAVERA S.A.')).toBe('supermercado');
  });

  it('handles the "SUPER <name>" convention generally, not just this one shop', () => {
    for (const name of ['SUPER LUQUEÑO', 'SUPER PANAMBI', 'Super Carolina S.R.L.']) {
      expect(categorize(name), name).toBe('supermercado');
    }
  });

  it('handles the format word however OCR splits it', () => {
    for (const name of ['SUPERMERCADO ESPAÑA', 'SUPER MERCADO ESPAÑA', 'HIPERMERCADO REAL']) {
      expect(categorize(name), name).toBe('supermercado');
    }
  });

  it('knows the chains by name', () => {
    for (const name of ['SUPERSEIS S.A.', 'Biggie Express', 'SALEMMA SUPERCENTER', 'CASA RICA']) {
      expect(categorize(name), name).toBe('supermercado');
    }
  });
});

describe('names that must NOT become supermarkets', () => {
  it('leaves "SUPER" businesses that sell something else alone', () => {
    for (const name of ['SUPER MOTOS S.A.', 'SUPER REPUESTOS DEL ESTE', 'SUPER POLLO']) {
      expect(categorize(name), name).not.toBe('supermercado');
    }
  });

  it('does not claim every company with an ordinary word in its name', () => {
    for (const name of ['INMOBILIARIA PRIMAVERA', 'SEGUROS EL PUEBLO', 'TRANSPORTES REAL S.A.']) {
      expect(categorize(name), name).not.toBe('supermercado');
    }
  });
});

describe('the bank patterns no longer swallow supermarkets', () => {
  it('files SUPERMERCADO CONTINENTAL as a supermarket, not a bank', () => {
    // 'financiero' matched \bcontinental\b and is declared before Alimentación,
    // so this went to "Bancos y finanzas" before the supermarket category
    // existed. The client had not hit it yet.
    expect(categorize('SUPERMERCADO CONTINENTAL')).toBe('supermercado');
    expect(categorize('SUPERMERCADO REGIONAL')).toBe('supermercado');
  });

  it('still recognises the actual banks', () => {
    for (const name of ['BANCO CONTINENTAL S.A.E.C.A.', 'BANCO REGIONAL', 'Bancard S.A.']) {
      expect(categorize(name), name).toBe('financiero');
    }
  });
});

describe('other ordinary words stay anchored', () => {
  it('does not read "Personal" or "Claro" as telecoms on their own', () => {
    expect(categorize('SERVICIOS PERSONAL DOMESTICO')).not.toBe('telecomunicaciones');
  });

  it('still recognises the telecoms', () => {
    expect(categorize('TIGO PARAGUAY')).toBe('telecomunicaciones');
  });
});

describe('restaurants remain their own thing', () => {
  it('classifies eating out', () => {
    expect(categorize('RESTAURANTE LA CASONA')).toBe('alimentacion');
    expect(categorize('PedidosYa Paraguay')).toBe('alimentacion');
  });
});

describe('the accent guard', () => {
  it('every pattern is written lowercase and unaccented', () => {
    // The input is normalised with NFD before matching, so an accented or
    // uppercase pattern can never fire. This is easy to break in review.
    for (const def of CATEGORIES) {
      for (const re of def.patterns) {
        expect(re.source, `${def.key}: ${re.source}`).toBe(normalizeText(re.source));
      }
    }
  });
});
