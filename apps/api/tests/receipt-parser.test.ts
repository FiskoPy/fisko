import { describe, expect, it } from 'vitest';
import { parseReceipt, receiptKey } from '../src/services/receipt-parser';

/**
 * Fixture transcribed from the real invoice the client photographed: a Cevelio
 * talonario made out to TecBio. Line order and spacing mimic what Vision
 * returns for a form like that — header block, handwritten body, IVA footer.
 */
const CEVELIO = `
CEVELIO
SERVICIO GENERALES Y METALURGICA
OTRAS ACTIVIDADES DE SERVICIOS PERSONALES N.C.P.
0981 258 168
Nueva Esperanza 2
Santa Rita | Alto Parana | Paraguay
de Estela Colman Franco
TIMBRADO Nº 18908353
Fecha inicio vigencia 08/06/2026
Fecha fin vigencia 30/09/2026
RUC: 6902656 - 4
FACTURA
Nº 001-001 0000071
Fecha de Emisión: 19 de Agosto de 2026
Condición de Venta: CONTADO
RUC: 80175384-8
Nombre/Razón Social: TecBio Solution
CANTIDAD DESCRIPCIÓN PRECIO UNITARIO
Fabricacion de puerta 900.000
900.000
SUBTOTALES: 900.000
TOTAL A PAGAR Novecientos mil 900.000
LIQUIDACIÓN DEL IVA: (5%) (10%) 81.818 TOTAL IVA: 81.818
`;

describe('parseReceipt — real Cevelio invoice', () => {
  const p = parseReceipt(CEVELIO);

  it('reads the issuer RUC and check digit', () => {
    expect(p.emisorRuc).toBe('6902656');
    expect(p.emisorDv).toBe(4);
  });

  it('reads the timbrado and document number', () => {
    expect(p.timbrado).toBe('18908353');
    expect(p.numeroDoc).toBe('001-001 0000071');
  });

  it('reads a date written out in Spanish', () => {
    expect(p.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  it('reads the total with Paraguayan thousand separators', () => {
    expect(p.total).toBe(900_000);
  });

  it('reads the IVA 10% from the footer', () => {
    expect(p.iva10).toBe(81_818);
  });

  it('reads the customer RUC', () => {
    expect(p.receptorRuc).toBe('80175384');
  });

  it('reports nothing missing and high confidence', () => {
    expect(p.missing).toEqual([]);
    expect(p.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('produces a key that dedupes a re-photograph of the same invoice', () => {
    expect(receiptKey(p)).toBe(receiptKey(parseReceipt(CEVELIO)));
    expect(receiptKey(p)).toContain('6902656');
  });
});

describe('parseReceipt — the IVA it read is arithmetically sound', () => {
  it('matches the Paraguayan rule of IVA included in the price', () => {
    const p = parseReceipt(CEVELIO);
    // 900.000 / 11 = 81.818,18 — the issuer wrote 81.818.
    expect(Math.abs(p.total! / 11 - p.iva10!)).toBeLessThan(1);
  });
});

describe('parseReceipt — degraded input', () => {
  it('reports what is missing instead of inventing it', () => {
    const p = parseReceipt('FACTURA\nborroso ilegible');
    expect(p.total).toBeNull();
    expect(p.emisorRuc).toBeNull();
    expect(p.missing).toContain('Total');
    expect(p.missing).toContain('RUC del emisor');
    expect(p.confidence).toBeLessThan(0.4);
  });

  it('never returns a zero or negative amount as a total', () => {
    expect(parseReceipt('TOTAL A PAGAR 0').total).toBeNull();
  });

  it('still keys a partially read receipt without throwing', () => {
    const key = receiptKey(parseReceipt('ilegible'));
    expect(key.startsWith('OCR:')).toBe(true);
  });

  it('reads a numeric date when the written one is absent', () => {
    const p = parseReceipt('Fecha de Emisión: 03/09/2026\nTOTAL A PAGAR 150.000');
    expect(p.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(p.total).toBe(150_000);
  });
});
