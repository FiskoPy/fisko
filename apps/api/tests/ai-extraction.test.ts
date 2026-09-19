import { describe, expect, it } from 'vitest';

import { fromExtraction, TOTALS_DISAGREE, type Extraction } from '../src/services/receipt-parser';
import { aiFixture } from './fixtures/ai';

/**
 * A vision model's reading of a photo, held to the parser's rules before
 * anything else looks at it: the same arithmetic, a RUC by its check digit, a
 * CDC by what it encodes, an exchange rate by the guaraní total printed next
 * to it, items by their sum.
 */

describe("the model's real answers", () => {
  it('a ticket that adds up keeps its amounts and items', () => {
    const p = fromExtraction(aiFixture('minas281'));
    expect(p).toMatchObject({
      emisorRuc: '5482866',
      emisorDv: 0,
      total: 91_925,
      gravada5: 44_425,
      iva5: 2_115,
      gravada10: 47_500,
      iva10: 4_318,
      totalsAgree: true,
      foreignCurrency: null,
    });
    expect(p.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-09-02');
    expect(p.items).toHaveLength(5);
    expect(p.items.reduce((s, it) => s + it.total, 0)).toBe(91_925);
    expect(p.missing).toEqual([]);
  });

  it('a KuDE keeps a CDC that fits its issuer, number and date', () => {
    const p = fromExtraction(aiFixture('fox-kude'));
    expect(p.cdc).toBe('01801265827001001001617522026090113141592659');
    expect(p).toMatchObject({ emisorRuc: '80126582', total: 48_000, iva10: 4_364, totalsAgree: true });
    expect(p.items.map((it) => it.total)).toEqual([5_000, 10_500, 4_500, 20_000, 8_000]);
  });

  it('items that do not add up to the total are dropped, the amounts kept', () => {
    const p = fromExtraction(aiFixture('primavera'));
    expect(p).toMatchObject({ total: 223_150, iva5: 3_647, iva10: 13_326, totalsAgree: true });
    expect(p.items).toEqual([]);
  });

  it('the IVA written as the gravada does not add up, and says so', () => {
    const p = fromExtraction(aiFixture('baratao'));
    expect(p.totalsAgree).toBe(false);
    expect(p.missing).toContain(TOTALS_DISAGREE);
  });

  it('a RUC with a wrong check digit is dropped, and a CDC that is not 44 digits ignored', () => {
    const p = fromExtraction(aiFixture('ecop-exenta'));
    expect(p.emisorRuc).toBeNull();
    expect(p.missing).toContain('RUC del emisor');
    expect(p.cdc).toBeNull();
    // Exempt only: no IVA, and none missing.
    expect(p).toMatchObject({ total: 300_000, exentas: 300_000, totalsAgree: true });
    expect(p.missing).not.toContain('IVA');
  });

  it('a dollar invoice: the CDC names the issuer the model swapped, the Gs total confirms the rate', () => {
    const x = aiFixture('usd-rrtop');
    expect(x.emisorRuc).toBe('80175384'); // the model's mistake: that is the buyer
    const p = fromExtraction(x);
    expect(p).toMatchObject({
      emisorRuc: '80156877',
      emisorDv: 3,
      emisorNombre: 'RR TOP AGRO E.A.S.',
      receptorRuc: '80175384',
      foreignCurrency: 'USD',
      tipoCambio: 6_027.92,
      total: 1_538,
      iva10: 139.82,
      totalsAgree: true,
    });
    // Derived to the cent, not to the guaraní.
    expect(p.gravada10).toBe(1_538.02);
    expect(p.derived).toContain('gravada10');
    expect(p.items).toHaveLength(3);
  });
});

describe('what the checks refuse to take on its word', () => {
  const usd = () => aiFixture('usd-rrtop');

  it('an exchange rate the guaraní total does not confirm', () => {
    expect(fromExtraction({ ...usd(), totalEnGuaranies: 9_000_000 }).tipoCambio).toBeNull();
    expect(fromExtraction({ ...usd(), totalEnGuaranies: null }).tipoCambio).toBeNull();
    expect(fromExtraction({ ...usd(), tipoCambio: 6_000 }).tipoCambio).toBeNull();
  });

  it('a dollar IVA that is not the gravada over 11, to the cent', () => {
    expect(fromExtraction({ ...usd(), gravada10: 1_538, iva10: 139.5, totalIva: null }).totalsAgree).toBe(false);
  });

  it('a date that does not exist, or is not plausible', () => {
    expect(fromExtraction({ ...usd(), fecha: '2026-02-30', cdc: null }).fechaEmision).toBeNull();
    expect(fromExtraction({ ...usd(), fecha: '1999-01-01', cdc: null }).fechaEmision).toBeNull();
    expect(fromExtraction({ ...usd(), fecha: '18/08/2026', cdc: null }).fechaEmision).toBeNull();
  });

  it('a CDC that encodes another number or date', () => {
    expect(fromExtraction({ ...usd(), numeroDoc: '001-001-0000638' }).cdc).toBeNull();
    expect(fromExtraction({ ...usd(), fecha: '2026-08-19' }).cdc).toBeNull();
  });

  it('negative amounts', () => {
    const p = fromExtraction({ ...aiFixture('minas281'), total: -91_925 });
    expect(p.total).toBeNull();
  });

  it('a credit note is a note', () => {
    const x: Extraction = { ...aiFixture('minas281'), tipoDocumento: 'nota_credito' };
    expect(fromExtraction(x).nota).toBe('credito');
  });
});
