/**
 * Real Paraguayan supermarket tickets photographed by the client on 2026-09-05,
 * with the values HE verified against the paper.
 *
 * These are the two receipts that exposed the parser's failures: it read an
 * item line as the IVA footer, took SUB TOTAL for TOTAL, and pulled a date out
 * of an order number. Every expectation below comes from the printed paper, not
 * from what the code happens to produce.
 *
 * The text is reconstructed from the photographs as Cloud Vision would return
 * it (DOCUMENT_TEXT_DETECTION, one line per printed line). Receipt A is only
 * the footer: the client's photo was cropped there, which is itself realistic —
 * people photograph the part they think matters.
 */

export interface ReceiptExpectation {
  emisorRuc?: string | null;
  emisorDv?: number | null;
  emisorNombre?: string | null;
  receptorRuc?: string | null;
  receptorNombre?: string | null;
  fechaEmision?: string | null; // ISO yyyy-mm-dd
  total?: number | null;
  gravada5?: number | null;
  gravada10?: number | null;
  iva5?: number | null;
  iva10?: number | null;
}

/**
 * Receipt A — footer only. Note "05%" with a leading zero, and that the IVA is
 * printed on its own "LIQUIDACION IVA 05%" lines.
 *
 * 42.000 / 21 = 2.000 and 545.600 / 11 = 49.600 — the printed IVA agrees with
 * the rule exactly, which is what makes this a good cross-check case.
 */
export const RECEIPT_A_TEXT = `
: Gs 587.600
L............: Gs 0
CUENTO.......: 0
ONDEO LEY 347-14: 0
: Gs 587.600
AL A PAGAR...: Gs 587.600
TOTAL EXENTAS.....: Gs 0
TOTAL GRAVADAS 05%: Gs 42.000
TOTAL GRAVADAS 10%: Gs 545.600
LIQUIDACION IVA 05%: Gs 2.000
LIQUIDACION IVA 10%: Gs 49.600
TOTAL IVA.........: Gs 51.600
JERO(A).: (507) CAJA1
FECHA.....: 05/09/2026
CI....: 4904579
`.trim();

export const RECEIPT_A_EXPECTED: ReceiptExpectation = {
  total: 587_600,
  gravada5: 42_000,
  gravada10: 545_600,
  iva5: 2_000,
  iva10: 49_600,
  fechaEmision: '2026-09-05',
};

/**
 * Receipt B — a complete supermarket ticket, and the harder of the two.
 *
 * Three traps live in here:
 *  1. Every item line ENDS with its IVA rate ("... 8.119 10"), so any pattern
 *     looking for "10" near a number matches an item first.
 *  2. The footer repeats "TOTAL GRAVADAS 10% GS:" — once as the taxable amount
 *     (146.589) and again, under "LIQUIDACION IVA", as the tax itself (13.326).
 *  3. "SF-0109-16-11-152724" contains "16-11-1527", which reads as a date.
 * Plus: the real total is TOTAL GS 223.150, not SUB TOTAL 223.179 — the 29
 * guaraní difference is the Ley 347 rounding (RES.347-SEDECO).
 */
export const RECEIPT_B_TEXT = `
SUPER PRIMAVERA S.A.
R.U.C. 80036323-0
Venta de productos diversos: Alimentos,
Electrod., Bebidas y tabaco entre otros.
Venta al por menor de productos de
panaderia, confiteria y otros prod.
Comercio al por mayor de productos
diversos. Alquiler de Inmuebles.
SANTA RITA - CASA CENTRAL
Avda. Dr. Gaspar R. De Francia
Tel: (0673) 220-270 / 221-549
www.primavera.com.py
SUPERMERCADO
Fecha/Hora: 01/09/26 18:27
Cajero    : CAJA 8
Cod. Descrip Cant. Precio Subt. IVA
245208 ROSCA CON GU 0,12 69.990 8.119 10
120291 SCHWEPPES CI 1,00 6.990 6.990 10
342602 AGUA MINERAL 3,00 1.600 4.800 10
495 TORTA NEGA M 0,24 45.500 11.102 10
245208 ROSCA CON GU 0,10 69.990 6.859 10
245208 ROSCA CON GU 0,11 69.990 7.419 10
220872 LECHE LACTOL 1,00 9.800 9.800 5
220872 LECHE LACTOL 3,00 9.800 29.400 5
119741 ACEITE GIRAS 1,00 29.400 29.400 5
322065 YPE JAB POLV 1,00 64.400 64.400 10
118790 ZAELI PIPOCA 1,00 7.990 7.990 5
542 PAN DE MAIZ 1,00 23.900 23.900 10
124159 TOALLA DE PA 1,00 5.200 5.200 10
349856 BOLSA P/HIEL 1,00 4.300 4.300 10
250150 NORTE SUR BO 1,00 2.800 2.800 10
343287 NORTE SUR PR 2,00 350 700 10
SUB TOTAL : 223.179
RES.347-SEDECO      29
TOTAL GS: 223.150
TOTAL EXENTAS   GS:        0
TOTAL GRAVADAS 10% GS:  146.589
TOTAL GRAVADAS  5% GS:   76.590
LIQUIDACION IVA
TOTAL GRAVADAS 10% GS:   13.326
TOTAL GRAVADAS  5% GS:    3.647
TOTAL IVA GS:            16.973
Bancard : 223.150
Cantidad de articulos: 16
CIoRUC: 4904579-2
Nombre: ALBERTO VELAZQUEZ
COND.VENTA: CONTADO
PEDIDO VTA NRO: SF-0109-16-11-152724
Consulte su factura electronica con el
numero de pedido en el siguiente link
primaverasuper.com/consulta-factura
** GRACIAS POR SU COMPRA **
`.trim();

export const RECEIPT_B_EXPECTED: ReceiptExpectation = {
  emisorRuc: '80036323',
  emisorDv: 0,
  emisorNombre: 'SUPER PRIMAVERA S.A.',
  receptorRuc: '4904579',
  receptorNombre: 'ALBERTO VELAZQUEZ',
  fechaEmision: '2026-09-01',
  total: 223_150,
  gravada10: 146_589,
  gravada5: 76_590,
  iva10: 13_326,
  iva5: 3_647,
};

/**
 * What the parser produced for these two BEFORE the fix, kept so a regression
 * is recognisable rather than merely "different".
 */
export const KNOWN_BAD = {
  A: { iva5: 45_045, iva10: 52_000, fechaEmision: '2026-04-01' },
  B: { total: 223_179, iva5: 0, iva10: 0, fechaEmision: '1527-11-16' },
};
