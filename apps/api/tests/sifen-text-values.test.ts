import { describe, expect, it } from 'vitest';

import { parseDte } from '../src/services/sifen';
import { DTE_XML, REAL_CDC } from './fixtures/dte';

/**
 * The XML parser used to coerce every numeric-looking tag, and a real remisión
 * mailed to the client on 2026-09-19 was stored with its referenced CDC as
 * "1.800265041001001e+42". Values now stay text; the amounts still read as
 * numbers because the parser converts them explicitly.
 */
describe('DTE values that look like numbers stay as printed', () => {
  it('keeps a referenced CDC as its 44 digits', () => {
    const xml = DTE_XML.replace(
      '</gDtipDE>',
      `</gDtipDE><gCamDEAsoc><dCdCDERef>${REAL_CDC}</dCdCDERef></gCamDEAsoc>`,
    );
    expect(parseDte(xml).originalCdc).toBe(REAL_CDC);
  });

  it('keeps the leading zeros of an item code', () => {
    const xml = DTE_XML.replace('<dCodInt>166408</dCodInt>', '<dCodInt>0000000010122</dCodInt>');
    expect(parseDte(xml).items[0]?.codigo).toBe('0000000010122');
  });

  it('keeps a description that happens to be all digits', () => {
    const xml = DTE_XML.replace(
      '<dDesProSer>AGUA MINERAL LA FUENTE SIN GAS 10LT.</dDesProSer>',
      '<dDesProSer>0428</dDesProSer>',
    );
    expect(parseDte(xml).items[0]?.descripcion).toBe('0428');
  });

  it('still reads the amounts, rates and document type as numbers', () => {
    const d = parseDte(DTE_XML);
    expect(d.tipoDoc).toBe(1);
    expect(d.totalOpe).toBe(237_500);
    expect(d.iva10).toBeCloseTo(18_545.45, 2);
    expect(d.emisorDv).toBe(7);
    expect(d.items.map((i) => i.ivaRate)).toEqual([10, 10, 5]);
    expect(d.items[0]?.cantidad).toBe(3);
  });
});
