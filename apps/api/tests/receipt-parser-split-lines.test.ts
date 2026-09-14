import { describe, expect, it } from 'vitest';

import { parseReceipt } from '../src/services/receipt-parser';

/**
 * The same two receipts as receipt-parser-real.test.ts, laid out the way Cloud
 * Vision often returns a two-column footer: the label on one line, its value
 * on the next.
 *
 * The first rewrite of the parser only read a value on the label's own line,
 * because the fixtures it was built against had been transcribed by hand with
 * both on one line. On 2026-09-13 the client's real photos came back "No
 * pudimos leer el total" — three in a row, each after a full Vision round
 * trip — which is what this layout produces under that assumption.
 */

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('receipt A with every value on the line after its label', () => {
  const p = parseReceipt(
    [
      'TOTAL A PAGAR........:',
      'Gs 587.600',
      'TOTAL EXENTAS.....:',
      'Gs 0',
      'TOTAL GRAVADAS 05%:',
      'Gs 42.000',
      'TOTAL GRAVADAS 10%:',
      'Gs 545.600',
      'LIQUIDACION IVA 05%:',
      'Gs 2.000',
      'LIQUIDACION IVA 10%:',
      'Gs 49.600',
      'TOTAL IVA.........:',
      'Gs 51.600',
      'FECHA.....: 05/09/2026',
    ].join('\n'),
  );

  it('still finds the total', () => expect(p.total).toBe(587_600));
  it('still reads IVA 5%', () => expect(p.iva5).toBe(2_000));
  it('still reads IVA 10%', () => expect(p.iva10).toBe(49_600));
  it('still reads the gross amounts', () => {
    expect(p.gravada5).toBe(42_000);
    expect(p.gravada10).toBe(545_600);
  });
  it('still reads the date', () => expect(iso(p.fechaEmision)).toBe('2026-09-05'));
});

describe('receipt B with the footer split the same way', () => {
  const p = parseReceipt(
    [
      'SUPER PRIMAVERA S.A.',
      'R.U.C. 80036323-0',
      'SUPERMERCADO',
      'Fecha/Hora: 01/09/26 18:27',
      '245208 ROSCA CON GU 0,12 69.990 8.119 10',
      '220872 LECHE LACTOL 1,00 9.800 9.800 5',
      'SUB TOTAL :',
      '223.179',
      'TOTAL GS:',
      '223.150',
      'TOTAL GRAVADAS 10% GS:',
      '146.589',
      'TOTAL GRAVADAS  5% GS:',
      '76.590',
      'LIQUIDACION IVA',
      'TOTAL GRAVADAS 10% GS:',
      '13.326',
      'TOTAL GRAVADAS  5% GS:',
      '3.647',
    ].join('\n'),
  );

  it('takes TOTAL GS from the next line, and still not SUB TOTAL', () => {
    expect(p.total).toBe(223_150);
  });

  it('still tells base from tax when both values sit on their own lines', () => {
    expect(p.gravada10).toBe(146_589);
    expect(p.iva10).toBe(13_326);
    expect(p.gravada5).toBe(76_590);
    expect(p.iva5).toBe(3_647);
  });
});

describe('the next-line fallback does not borrow a neighbouring label', () => {
  it('leaves the total empty when the next line is another label', () => {
    // "TOTAL EXENTAS: 0" has words on it, so its 0 is not the total.
    const p = parseReceipt('TOTAL A PAGAR\nTOTAL EXENTAS: 0\nGRACIAS');
    expect(p.total).toBeNull();
  });

  it('does not treat an item line as the value of the line above it', () => {
    const p = parseReceipt('TOTAL A PAGAR\n245208 ROSCA CON GU 0,12 69.990 8.119 10');
    expect(p.total).toBeNull();
  });

  it.todo(
    'labels in one block and all values in another (Vision column mode) — needs a real OCR sample',
  );
});
