import { describe, expect, it } from 'vitest';

import { printedParts, type FiscalSummary } from '../src/modules/reports/reports.service';
import { categorize } from '../src/services/categories';

/**
 * What the page says, added up by the person holding it.
 *
 * Every figure is exact to the guaraní inside its own invoice, but a period is
 * a sum of them, and rounding five sums separately leaves the column one
 * guaraní short of the total it sits above.
 */

const summary = (over: Partial<FiscalSummary>): FiscalSummary =>
  ({
    period: { from: null, to: null },
    count: 0,
    totalOpe: 0,
    totalIva: 0,
    iva5: 0,
    iva10: 0,
    baseGrav5: 0,
    baseGrav10: 0,
    exentas: 0,
    ventas: 0,
    compras: 0,
    ivaCredito: 0,
    ivaDebito: 0,
    saldoAnterior: 0,
    ivaAPagar: 0,
    saldoSiguiente: 0,
    rentaRegimen: 'IRE',
    rentaEstimado: 0,
    irpEstimado: 0,
    sinConversion: 0,
    documentos: 0,
    sinOperacion: 0,
    byMonth: [],
    byCategory: [],
    ...over,
  }) as FiscalSummary;

describe('the printed column adds up to the printed total', () => {
  it("does on the client's own August", () => {
    // The four dollar invoices of August 2026, converted: base and IVA each
    // carry cents, and rounded apart they came to 35.688.755 under a total of
    // 35.688.756.
    const s = summary({
      baseGrav10: 32_444_312.47,
      iva10: 3_244_443.49,
      totalOpe: 35_688_755.96,
    });
    const p = printedParts(s);
    expect(p.base5 + p.iva5 + p.base10 + p.iva10 + p.exentas).toBe(p.total);
    expect(p.total).toBe(35_688_756);
  });

  it('holds with exempt amounts and both rates', () => {
    const s = summary({
      baseGrav5: 1_000_000.4,
      iva5: 50_000.4,
      baseGrav10: 2_000_000.4,
      iva10: 200_000.4,
      exentas: 300_000.4,
      totalOpe: 3_550_002,
    });
    const p = printedParts(s);
    expect(p.base5 + p.iva5 + p.base10 + p.iva10 + p.exentas).toBe(p.total);
  });
});

describe('an agrochemical supplier is not "Otros"', () => {
  it('reads the trade from the name, however it is spelled', () => {
    // Both of the client's suppliers, as their invoices name them.
    expect(categorize("CHD'S AGROCHEMICALS S.A.I.C.", ['MERCADERIA'])).toBe('insumos_agricolas');
    expect(categorize('RR TOP AGRO E.A.S.', [])).toBe('insumos_agricolas');
    expect(categorize('AGROQUIMICA DEL ESTE SRL', [])).toBe('insumos_agricolas');
    expect(categorize('AGROPECUARIA SAN JOSE', [])).toBe('insumos_agricolas');
    // …and from what is on the line when the name says nothing.
    expect(categorize('DISTRIBUIDORA DEL ESTE', ['CAPAZ (SULFENTRAZONA) LT'])).toBe('insumos_agricolas');
    expect(categorize('DISTRIBUIDORA DEL ESTE', ['UREA GRANULADA 46%'])).toBe('insumos_agricolas');
  });

  it('does not swallow a shop that merely sounds like one', () => {
    expect(categorize('AGROMAR TURISMO', ['PASAJE'])).not.toBe('insumos_agricolas');
    expect(categorize('SUPERMERCADO REAL', ['ARROZ'])).toBe('supermercado');
    expect(categorize('FARMACIA GUARANI', ['IBUPROFENO'])).not.toBe('insumos_agricolas');
  });
});
