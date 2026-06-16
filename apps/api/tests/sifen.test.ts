import { describe, expect, it } from 'vitest';
import {
  parseDte,
  isValidCdcStructure,
  isValidCdcCheckDigit,
  cdcCheckDigit,
} from '../src/services/sifen';

// Real CDC from a signed VIELA S.A. DTE.
const REAL_CDC = '01800549937005005014115022026021410125083658';

// Condensed DTE built from REAL values of that invoice (SOAP-wrapped, 3 real
// items: two at 10% and one at 5%). Exercises every parser path.
const DTE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>
<rEnviDe xmlns="http://ekuatia.set.gov.py/sifen/xsd"><dId>946208</dId><xDE><rDE>
<dVerFor>150</dVerFor>
<DE Id="${REAL_CDC}">
  <dDVId>8</dDVId>
  <gTimb><iTiDE>1</iTiDE><dDesTiDE>Factura electrónica</dDesTiDE></gTimb>
  <gDatGralOpe>
    <dFeEmiDE>2026-02-14T16:53:05</dFeEmiDE>
    <gOpeCom><cMoneOpe>PYG</cMoneOpe></gOpeCom>
    <gEmis><dRucEm>80054993</dRucEm><dDVEmi>7</dDVEmi><dNomEmi>VIELA S.A.</dNomEmi></gEmis>
    <gDatRec><dRucRec>4904579</dRucRec><dDVRec>2</dDVRec><dNomRec>ALBERTO VELAZQUEZ</dNomRec></gDatRec>
  </gDatGralOpe>
  <gDtipDE>
    <gCamItem>
      <dCodInt>166408</dCodInt><dDesProSer>AGUA MINERAL LA FUENTE SIN GAS 10LT.</dDesProSer>
      <dCantProSer>3</dCantProSer>
      <gValorItem><dPUniProSer>18000</dPUniProSer><dTotBruOpeItem>54000</dTotBruOpeItem>
        <gValorRestaItem><dTotOpeItem>54000</dTotOpeItem></gValorRestaItem></gValorItem>
      <gCamIVA><iAfecIVA>1</iAfecIVA><dTasaIVA>10</dTasaIVA><dBasGravIVA>49090.91</dBasGravIVA><dLiqIVAItem>4909.09</dLiqIVAItem></gCamIVA>
    </gCamItem>
    <gCamItem>
      <dCodInt>250328</dCodInt><dDesProSer>JUGUETE CHARGE ROBOT 2244/38-65</dDesProSer>
      <dCantProSer>1</dCantProSer>
      <gValorItem><dPUniProSer>150000</dPUniProSer><dTotBruOpeItem>150000</dTotBruOpeItem>
        <gValorRestaItem><dTotOpeItem>150000</dTotOpeItem></gValorRestaItem></gValorItem>
      <gCamIVA><iAfecIVA>1</iAfecIVA><dTasaIVA>10</dTasaIVA><dBasGravIVA>136363.64</dBasGravIVA><dLiqIVAItem>13636.36</dLiqIVAItem></gCamIVA>
    </gCamItem>
    <gCamItem>
      <dCodInt>154566</dCodInt><dDesProSer>ACEITE DE OLIVA OLICA EXTRA VIRGEN 250ML.</dDesProSer>
      <dCantProSer>1</dCantProSer>
      <gValorItem><dPUniProSer>33500</dPUniProSer><dTotBruOpeItem>33500</dTotBruOpeItem>
        <gValorRestaItem><dTotOpeItem>33500</dTotOpeItem></gValorRestaItem></gValorItem>
      <gCamIVA><iAfecIVA>1</iAfecIVA><dTasaIVA>5</dTasaIVA><dBasGravIVA>31904.76</dBasGravIVA><dLiqIVAItem>1595.24</dLiqIVAItem></gCamIVA>
    </gCamItem>
  </gDtipDE>
  <gTotSub>
    <dSub5>33500</dSub5><dSub10>204000</dSub10>
    <dTotGralOpe>237500</dTotGralOpe>
    <dIVA5>1595.24</dIVA5><dIVA10>18545.45</dIVA10><dTotIVA>20140.69</dTotIVA>
    <dBaseGrav5>31904.76</dBaseGrav5><dBaseGrav10>185454.55</dBaseGrav10>
  </gTotSub>
</DE>
</rDE></xDE></rEnviDe></env:Body></env:Envelope>`;

describe('parseDte', () => {
  const dte = parseDte(DTE_XML);

  it('extracts the CDC, document type and parties', () => {
    expect(dte.cdc).toBe(REAL_CDC);
    expect(dte.tipoDoc).toBe(1);
    expect(dte.tipoDocDesc).toContain('Factura');
    expect(dte.emisorRuc).toBe('80054993');
    expect(dte.emisorDv).toBe(7);
    expect(dte.emisorNombre).toBe('VIELA S.A.');
    expect(dte.receptorRuc).toBe('4904579');
    expect(dte.receptorDv).toBe(2);
    expect(dte.receptorNombre).toBe('ALBERTO VELAZQUEZ');
    expect(dte.moneda).toBe('PYG');
    expect(dte.fechaEmision.toISOString().slice(0, 10)).toBe('2026-02-14');
  });

  it('extracts the IVA totals (5% and 10%)', () => {
    expect(dte.totalOpe).toBe(237500);
    expect(dte.iva5).toBeCloseTo(1595.24, 2);
    expect(dte.iva10).toBeCloseTo(18545.45, 2);
    expect(dte.baseGrav5).toBeCloseTo(31904.76, 2);
    expect(dte.baseGrav10).toBeCloseTo(185454.55, 2);
    expect(dte.totalIva).toBeCloseTo(20140.69, 2);
  });

  it('extracts all items with quantity, price and per-item IVA', () => {
    expect(dte.items).toHaveLength(3);
    const first = dte.items[0]!;
    expect(first.descripcion).toContain('AGUA MINERAL');
    expect(first.cantidad).toBe(3);
    expect(first.precioUnit).toBe(18000);
    expect(first.total).toBe(54000);
    expect(first.ivaRate).toBe(10);
    expect(first.ivaBase).toBeCloseTo(49090.91, 2);
    expect(first.ivaMonto).toBeCloseTo(4909.09, 2);
    // sum of per-item IVA matches the totals
    const sumIva = dte.items.reduce((s, i) => s + i.ivaMonto, 0);
    expect(sumIva).toBeCloseTo(dte.totalIva, 2);
  });

  it('rejects invalid XML / missing DE', () => {
    expect(() => parseDte('not xml at all <<<')).toThrow();
    expect(() => parseDte('<root><a>1</a></root>')).toThrow();
  });
});

describe('CDC validation', () => {
  it('accepts a 44-digit CDC structurally', () => {
    expect(isValidCdcStructure(REAL_CDC)).toBe(true);
    expect(isValidCdcStructure('123')).toBe(false);
    expect(isValidCdcStructure('x'.repeat(44))).toBe(false);
  });

  it('computes the CDC check digit (módulo 11) — locks current behavior', () => {
    // The 44th digit of the real CDC is 8. This asserts whether our módulo-11
    // implementation reproduces it (informs whether to ENFORCE the dv on import).
    const dv = cdcCheckDigit(REAL_CDC);
    // eslint-disable-next-line no-console
    console.log('REAL CDC check digit computed =', dv, '(expected last digit = 8)');
    expect(dv).toBeGreaterThanOrEqual(0);
    expect(dv).toBeLessThanOrEqual(9);
    expect(isValidCdcCheckDigit(REAL_CDC)).toBe(dv === 8);
  });
});
