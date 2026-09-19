import { describe, expect, it } from 'vitest';

import { parseBest, parseReceipt, TOTALS_DISAGREE } from '../src/services/receipt-parser';
import { layoutsOf } from '../src/services/vision-layout';
import { visionFixture, type VisionFixture } from './fixtures/vision';

/**
 * End to end over what Vision really returned for the client's photos of
 * 2026-09-15. Both layouts are parsed and the better reading kept, exactly as
 * importPhoto does. Every expectation is the printed paper's, not the code's.
 */

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function read(name: VisionFixture) {
  const a = visionFixture(name);
  const r = parseBest(layoutsOf(a));
  if (!r) throw new Error(`no reading for ${name}`);
  return r;
}

describe('Super Primavera — stored as Gs 29', () => {
  const { parsed: p, layout } = read('primavera-ticket');

  it('reads TOTAL GS, not the rounding printed on the line above', () => {
    expect(p.total).toBe(223_150);
  });

  it('reads both rates', () => {
    expect(p.gravada10).toBe(146_589);
    expect(p.iva10).toBe(13_326);
    expect(p.gravada5).toBe(76_590);
    expect(p.iva5).toBe(3_647);
  });

  it('agrees with its own arithmetic, rounding included', () => {
    expect(p.totalsAgree).toBe(true);
    expect(p.totalIva).toBe(16_973);
    expect(p.missing).toEqual([]);
  });

  it('reads the issuer and the date', () => {
    expect(p.emisorRuc).toBe('80036323');
    expect(p.emisorNombre).toBe('SUPER PRIMAVERA S.A.');
    expect(iso(p.fechaEmision)).toBe('2026-09-01');
  });

  it('chose rebuilt rows, not the block order that stored Gs 29', () => {
    expect(layout).toMatch(/^rows/);
  });
});

describe("Vision's block text on its own — what production parsed", () => {
  const p = parseReceipt(visionFixture('primavera-ticket').text as string);

  it('no longer yields Gs 29: an amount from the next line needs the footer to confirm it', () => {
    expect(p.total).toBeNull();
    expect(p.missing).toContain('Total');
  });

  it('and reports the contradiction it found', () => {
    expect(p.totalsAgree).toBe(false);
    expect(p.missing).toContain(TOTALS_DISAGREE);
  });
});

describe('FOX KuDE — stored as Gs 8.000 with no IVA', () => {
  const a = visionFixture('fox-kude');
  const { parsed: p } = read('fox-kude');

  it('reads the total', () => expect(p.total).toBe(48_000));

  it('reads the 10% amount and its IVA', () => {
    expect(p.gravada10).toBe(48_000);
    expect(p.iva10).toBe(4_364);
  });

  it('reads the 5% as the zero it is', () => {
    expect(p.gravada5).toBe(0);
    expect(p.iva5).toBe(0);
  });

  it('agrees with its own arithmetic, the printed IVA total included', () => {
    expect(p.totalsAgree).toBe(true);
    expect(p.totalIva).toBe(4_364);
    expect(p.missing).toEqual([]);
  });

  it('reads the issuer, the number and the date', () => {
    expect(p.emisorRuc).toBe('80126582');
    expect(p.emisorDv).toBe(7);
    expect(p.emisorNombre).toMatch(/REGALOS & DECOR E\.A\.S/);
    expect(p.numeroDoc).toBe('001-001-0016175');
    expect(iso(p.fechaEmision)).toBe('2026-09-01');
  });

  it('recognises the CDC printed at its foot, so its XML is not counted a second time', () => {
    const printed = (a.text as string).match(/(?<!\d)\d{44}(?!\d)/)?.[0];
    expect(printed).toBeDefined();
    expect(p.cdc).toBe(printed);
  });

  it("does not take the label's own word for the buyer's name", () => {
    expect(p.receptorNombre).not.toMatch(/^del\b/i);
    expect(p.receptorNombre).toMatch(/^X+ X+, X+$/);
  });
});

describe('MINAS281 MERCADO — right before, and still right', () => {
  for (const name of ['minas281-ticket', 'minas281-ticket-retake'] as const) {
    it(`${name}: every fiscal field matches the paper`, () => {
      const { parsed: p } = read(name);
      expect(p.total).toBe(91_925);
      expect(p.gravada5).toBe(44_425);
      expect(p.iva5).toBe(2_115);
      expect(p.gravada10).toBe(47_500);
      expect(p.iva10).toBe(4_318);
      expect(p.totalIva).toBe(6_433);
      expect(p.totalsAgree).toBe(true);
      expect(p.missing).toEqual([]);
    });

    it(`${name}: issuer, number and date`, () => {
      const { parsed: p } = read(name);
      expect(p.emisorRuc).toBe('5482866');
      expect(p.emisorDv).toBe(0);
      expect(p.emisorNombre).toBe('MINAS281 MERCADO');
      expect(p.numeroDoc).toBe('001-003-0003166');
      expect(iso(p.fechaEmision)).toBe('2026-09-02');
    });
  }
});

describe('Baratão talonario — refused for "no IVA"', () => {
  const { parsed: p } = read('baratao-talonario');

  it('reads the total printed above its label', () => expect(p.total).toBe(160_000));

  it('reads the IVA printed above its labels, placed by arithmetic', () => {
    expect(p.iva10).toBe(14_545);
    expect(p.iva5).toBe(0);
    expect(p.totalIva).toBe(14_545);
  });

  it('agrees with itself and reports nothing missing', () => {
    expect(p.totalsAgree).toBe(true);
    expect(p.missing).toEqual([]);
  });

  it('reads the issuer, the timbrado and the written date', () => {
    expect(p.emisorRuc).toBe('6700626');
    expect(p.timbrado).toBe('18757069');
    expect(iso(p.fechaEmision)).toBe('2026-09-16');
    expect(p.emisorNombre).not.toMatch(/RUC/);
    expect(p.foreignCurrency).toBeNull();
  });
});
