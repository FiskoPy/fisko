import { describe, expect, it } from 'vitest';

import { parseBest, parseReceipt, TOTALS_DISAGREE } from '../src/services/receipt-parser';
import { cdcCheckDigit } from '../src/services/sifen';
import { REAL_CDC } from './fixtures/dte';
import { RECEIPT_B_TEXT } from './fixtures/receipts';

/**
 * The rules that keep a misread photo from becoming a wrong tax record. Each
 * case here is one a reviewer demonstrated against the real Vision responses
 * of 2026-09-15, reduced to the lines that matter.
 */

const lines = (...l: string[]) => l.join('\n');

describe('amounts that contradict each other are reported, never stored as sound', () => {
  it("flags production's FOX symptom: a total with every gravada read as zero", () => {
    const p = parseReceipt(
      lines('Total: Gs 8.000', 'Gravadas 05%: Gs 0', 'Gravadas 10%: Gs 0', 'IVA 5%: Gs 0', 'IVA 10%: Gs 0'),
    );
    expect(p.totalsAgree).toBe(false);
    expect(p.missing).toContain(TOTALS_DISAGREE);
    expect(p.confidence).toBeLessThanOrEqual(0.5);
  });

  it('treats a total over nothing taxed as a contradiction, however small', () => {
    const p = parseReceipt(lines('Total: Gs 1', 'Gravadas 05%: Gs 0', 'Gravadas 10%: Gs 0'));
    expect(p.totalsAgree).toBe(false);
  });

  it('checks each IVA against its own gravada', () => {
    // A keystoned KuDE: 4.364 of IVA moved onto the 5% line, over a base of 0,
    // while the total still matched.
    const p = parseReceipt(
      lines(
        'Total Pago. Gs 48.000',
        'Gravadas 05%: Gs 0',
        'Gravadas 10%: Gs 48.000',
        'IVA 5%: Gs 4.364',
        'IVA 10%: Gs 4.364',
      ),
    );
    expect(p.totalsAgree).toBe(false);
    expect(p.missing).toContain(TOTALS_DISAGREE);
  });

  it('checks both rates against the printed TOTAL IVA', () => {
    // A lost 5% line: the total and the 10% rate agree; the IVA total does not.
    const p = parseReceipt(
      lines(
        'TOTAL GS: 146.589',
        'TOTAL GRAVADAS 10% GS: 146.589',
        'LIQUIDACION IVA 10%: 13.326',
        'TOTAL IVA GS: 16.973',
      ),
    );
    expect(p.totalsAgree).toBe(false);
  });

  it('reads a KuDE\'s "Liquidación Total del IVA" as that check too', () => {
    const p = parseReceipt(
      lines('Total Pago. Gs 48.000', 'Gravadas 10%: Gs 48.000', 'liquidación Total del IVA: Gs 4.364'),
    );
    expect(p.totalIva).toBe(4_364);
    expect(p.totalsAgree).toBe(true);
  });

  it('does not go looking for a lower-ranked total that happens to fit', () => {
    // That search once swapped a correct total for a gravada line.
    const p = parseReceipt(
      lines('TOTAL A PAGAR: 29', 'TOTAL: 223.150', 'TOTAL GRAVADAS 10%: 146.560', 'TOTAL GRAVADAS 5%: 76.590'),
    );
    expect(p.total).toBe(29);
    expect(p.totalsAgree).toBe(false);
  });

  it('treats a tax set aside for exceeding a tenth of the total as a contradiction', () => {
    const p = parseReceipt(lines('TOTAL A PAGAR: 29', 'LIQUIDACION IVA 10%: 13.326'));
    expect(p.totalsAgree).toBe(false);
  });

  it('tolerates the Ley 347 rounding between gravadas and total', () => {
    // 146.589 + 76.590 = 223.179; the ticket charges 223.150.
    const p = parseReceipt(RECEIPT_B_TEXT);
    expect(p.total).toBe(223_150);
    expect(p.totalsAgree).toBe(true);
  });

  it('says nothing when there is nothing to compare the total with', () => {
    const p = parseReceipt('TOTAL A PAGAR: 50.000');
    expect(p.totalsAgree).toBeNull();
    expect(p.missing).not.toContain(TOTALS_DISAGREE);
  });
});

describe('a total read from the line under its label', () => {
  it('stands when the footer confirms it', () => {
    const p = parseReceipt(
      lines('TOTAL A PAGAR', 'Gs 587.600', 'TOTAL GRAVADAS 05%: Gs 42.000', 'TOTAL GRAVADAS 10%: Gs 545.600'),
    );
    expect(p.total).toBe(587_600);
  });

  it('is not taken on trust when nothing confirms it', () => {
    // A KuDE's last item sits right under "Total:".
    const p = parseReceipt(lines('Tolal:', 'Gs 8.000', 'Gs 48.000'));
    expect(p.total).toBeNull();
    expect(p.missing).toContain('Total');
  });

  it('is never a quantity printed before the label', () => {
    expect(parseReceipt(lines('CARTULINA CARTON 1 UN Tolal', 'Gs 8.000')).total).toBeNull();
  });
});

describe('labels that are, and are not, the total', () => {
  it('reads "Tolal" as Total', () => {
    expect(parseReceipt('Tolal: Gs 48.000\nGravadas 10%: Gs 48.000').total).toBe(48_000);
  });

  it('reads a total whose first letter the photo cut off', () => {
    expect(parseReceipt('OTAL: Gs 91.925').total).toBe(91_925);
  });

  it('leaves longer words alone: "Totales" is a heading, not a total', () => {
    expect(parseReceipt('Detalle Totales (Base Imponible) 48.000').total).toBeNull();
  });

  it('does not take "BTOTAL" — SUBTOTAL with its edge cut — for a total', () => {
    expect(parseReceipt(lines('BTOTAL: 85.000', 'TOTAL GRAVADAS 10%: 85.000')).total).toBeNull();
  });

  it('does not take "TOTAL PAGADO", the cash handed over', () => {
    const p = parseReceipt(lines('TOTAL GS: 223.150', 'TOTAL PAGADO: 250.000', 'TOTAL GRAVADAS 10% GS: 223.150'));
    expect(p.total).toBe(223_150);
  });

  it('does not take a line with a rate on it, whatever word it lost', () => {
    // "TOTAL GRAVADAS 10%" without its middle word.
    expect(parseReceipt(lines('TOTAL 10%: Gs 47.500', 'LIQUIDACION IVA 10%: Gs 4.318')).total).toBeNull();
  });

  it('does not take a bare TOTAL right above the Ley 347 rounding', () => {
    // It is the subtotal before rounding, with its "SUB" lost.
    expect(parseReceipt(lines('TOTAL: 223.179', 'RES.347-SEDECO: 29')).total).toBeNull();
  });

  it('takes "Total Pago" on a KuDE', () => {
    expect(parseReceipt('Total Descuento: Gs 0\nTotal Pago. Gs 48.000').total).toBe(48_000);
  });
});

describe('the CDC printed on a KuDE', () => {
  const kude = (...extra: string[]) =>
    lines(
      'KuDE - Factura Electrónica',
      'VIELA S.A.',
      'RUC: 80054993-7',
      'Factura Electrónica: 005-005-0141150',
      'Fecha de emisión: 14/02/2026',
      ...extra,
    );
  /** The same CDC with its RUC or its security code replaced, check digit recomputed. */
  const variant = (from: number, digits: string) => {
    const c43 = REAL_CDC.slice(0, from) + digits + REAL_CDC.slice(from + digits.length, 43);
    return c43 + String(cdcCheckDigit(c43));
  };

  it('is read when it matches the issuer, the number and the date printed', () => {
    expect(parseReceipt(kude(REAL_CDC)).cdc).toBe(REAL_CDC);
  });

  it('is read when printed in groups of four', () => {
    const grouped = (REAL_CDC.match(/.{4}/g) as string[]).join(' ');
    expect(parseReceipt(kude(`CDC: ${grouped}`)).cdc).toBe(REAL_CDC);
  });

  it('is ignored when a digit was misread', () => {
    const bad = REAL_CDC.slice(0, 43) + String((Number(REAL_CDC[43]) + 1) % 10);
    expect(parseReceipt(kude(bad)).cdc).toBeNull();
  });

  it('is ignored when it names another issuer, even with a valid check digit', () => {
    // Four digits of a CDC sit under weight 11 and escape the check digit; the
    // page's own RUC, number and date are what catch a misread there.
    expect(parseReceipt(kude(variant(2, '80012345'))).cdc).toBeNull();
  });

  it('is ignored without the issuer, number and date to check it against', () => {
    expect(parseReceipt(`Consulte en ekuatia\n${REAL_CDC}`).cdc).toBeNull();
  });

  it('skips a CDC printed as the associated document', () => {
    const other = variant(34, '271828182');
    expect(parseReceipt(kude(`CDC asociado: ${other}`, REAL_CDC)).cdc).toBe(REAL_CDC);
  });

  it('leaves two different CDCs undecided', () => {
    expect(parseReceipt(kude(variant(34, '271828182'), REAL_CDC)).cdc).toBeNull();
  });

  it('is absent on a plain ticket', () => {
    expect(parseReceipt(RECEIPT_B_TEXT).cdc).toBeNull();
  });
});

describe('credit and debit notes', () => {
  it('recognises a credit note, and keys it by no CDC', () => {
    const p = parseReceipt(
      lines(
        'KuDE de Nota de Crédito Electrónica',
        'VIELA S.A.',
        'RUC: 80054993-7',
        'Nota de Crédito Electrónica: 005-005-0141150',
        'Fecha de emisión: 14/02/2026',
        REAL_CDC,
      ),
    );
    expect(p.nota).toBe('credito');
    expect(p.cdc).toBeNull();
  });

  it('recognises a debit note', () => {
    expect(parseReceipt('NOTA DE DÉBITO\nACME S.A.').nota).toBe('debito');
  });

  it('leaves an invoice alone', () => {
    expect(parseReceipt(RECEIPT_B_TEXT).nota).toBeNull();
  });
});

describe("the buyer's name", () => {
  it('skips "del" left over from "Nombre del Receptor"', () => {
    expect(parseReceipt('Nombre del PEREZ GOMEZ, ANA').receptorNombre).toBe('PEREZ GOMEZ, ANA');
  });

  it('takes what follows the colon of a long label', () => {
    expect(parseReceipt('Nombre o Razón Social: ACME S.A.').receptorNombre).toBe('ACME S.A.');
  });

  it('strips a long label that lost its colon', () => {
    expect(parseReceipt('Nombre o Razón Social ACME S.A.').receptorNombre).toBe('ACME S.A.');
  });

  it('keeps a surname that happens to start with "Del"', () => {
    expect(parseReceipt('Nombre: DEL PUERTO JUAN').receptorNombre).toBe('DEL PUERTO JUAN');
  });

  it('keeps a surname particle when the colon was lost', () => {
    expect(parseReceipt('Nombre DE LA FUENTE JUAN').receptorNombre).toBe('DE LA FUENTE JUAN');
  });

  it('takes the next line when the label stands alone', () => {
    expect(parseReceipt('Nombre del\nPEREZ GOMEZ, ANA').receptorNombre).toBe('PEREZ GOMEZ, ANA');
  });
});

describe("the buyer's RUC", () => {
  it('is read on the line after its label when the layout splits them', () => {
    const p = parseReceipt(
      lines('ACME S.A.', 'RUC: 80012345-6', 'Fecha de emisión: 01/09/2026', 'RUC/CI', ': 1234567-8'),
    );
    expect(p.receptorRuc).toBe('1234567');
  });
});

describe("the issuer's name", () => {
  it("prefers the registered name over a KuDE's logo text", () => {
    const p = parseReceipt(
      lines('KuDE - Factura Electrónica', 'AP FOX', 'RUC: 80126582-7', 'FOX REGALOS & DECOR E.A.S', 'Avda 14 de Mayo'),
    );
    expect(p.emisorNombre).toBe('FOX REGALOS & DECOR E.A.S');
  });

  it('falls back to the first name-like line when none has a legal form', () => {
    const p = parseReceipt(lines('MINAS281 MERCADO', 'DE SUSANA FARIAS MOREIRA', 'RUC: 5482866-0'));
    expect(p.emisorNombre).toBe('MINAS281 MERCADO');
  });

  it("does not take the buyer's company for the issuer", () => {
    const p = parseReceipt(lines('MINAS281 MERCADO', 'RUC: 5482866-0', 'Cliente: PEREZ HERMANOS S.A.'));
    expect(p.emisorNombre).toBe('MINAS281 MERCADO');
  });
});

describe('the issue date', () => {
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  it('reads "Emisión" as its label when "Fecha" is lost', () => {
    expect(iso(parseReceipt(lines('Vigencia 30/05/2025', 'Emisión. 01/09/2026 17:48')).fechaEmision)).toBe(
      '2026-09-01',
    );
  });

  it("skips the timbrado's start date when \"Vigencia\" is lost", () => {
    expect(iso(parseReceipt(lines('Inicio de: 30/05/2025', '01/09/2026 17:48')).fechaEmision)).toBe('2026-09-01');
  });
});

describe('the IVA', () => {
  it('is reported missing when none was read', () => {
    expect(parseReceipt('TOTAL: 50.000').missing).toContain('IVA');
  });

  it('is not reported missing on an exempt-only invoice', () => {
    const p = parseReceipt(lines('TOTAL: 50.000', 'TOTAL EXENTAS: 50.000'));
    expect(p.missing).not.toContain('IVA');
    expect(p.totalsAgree).toBe(true);
  });
});

describe('parseBest', () => {
  const blocks = 'RES.347-SEDECO:\nTOTAL GS:\n29\n223.150\nTOTAL GRAVADAS 10% GS:\n223.150';
  const rows = 'RES.347-SEDECO: 29\nTOTAL GS: 223.150\nTOTAL GRAVADAS 10% GS: 223.150';

  it('keeps the reading whose numbers add up, in either order', () => {
    for (const order of [
      [
        { layout: 'blocks', text: blocks },
        { layout: 'rows', text: rows },
      ],
      [
        { layout: 'rows', text: rows },
        { layout: 'blocks', text: blocks },
      ],
    ]) {
      const r = parseBest(order);
      expect(r?.layout).toBe('rows');
      expect(r?.parsed.total).toBe(223_150);
    }
  });

  it('prefers the earlier candidate on a tie', () => {
    const r = parseBest([
      { layout: 'rows', text: rows },
      { layout: 'blocks', text: rows },
    ]);
    expect(r?.layout).toBe('rows');
  });

  it('will not choose between two totals that nothing confirms', () => {
    const r = parseBest([
      { layout: 'rows', text: 'TOTAL: 29' },
      { layout: 'blocks', text: 'TOTAL: 223.150' },
    ]);
    expect(r?.parsed.total).toBeNull();
    expect(r?.parsed.missing).toContain('Total');
  });

  it('skips a layout that could not be built', () => {
    expect(
      parseBest([
        { layout: 'rows', text: null },
        { layout: 'blocks', text: 'TOTAL: 1.000' },
      ])?.layout,
    ).toBe('blocks');
  });

  it('returns null when there is nothing to read', () => {
    expect(parseBest([])).toBeNull();
  });

  it('refuses two readings that both add up but split the amounts differently', () => {
    const r = parseBest([
      { layout: 'rows', text: lines('Total Pago. Gs 48.000', 'Gravadas 05%: Gs 48.000', 'Gravadas 10%: Gs 0') },
      { layout: 'rows-unbent', text: lines('Total Pago. Gs 48.000', 'Gravadas 05%: Gs 0', 'Gravadas 10%: Gs 48.000') },
    ]);
    expect(r?.parsed.totalsAgree).toBe(false);
    expect(r?.parsed.missing).toContain(TOTALS_DISAGREE);
  });

  it('prefers the reading that read a gravada over one that computed it from the IVA', () => {
    const computed = lines('TOTAL: 91.925', 'LIQUIDACION IVA 05%: 2.115', 'TOTAL GRAVADAS 10%: 47.500');
    const read = lines('TOTAL: 91.925', 'TOTAL GRAVADAS 05%: 44.425', 'LIQUIDACION IVA 05%: 2.115', 'TOTAL GRAVADAS 10%: 47.500');
    const r = parseBest([
      { layout: 'rows', text: computed },
      { layout: 'blocks', text: read },
    ]);
    expect(r?.layout).toBe('blocks');
    expect(r?.parsed.gravada5).toBe(44_425);
  });

  it('keeps a note found by any reading, even one that lost', () => {
    const invoice = lines('ACME S.A.', 'RUC: 80012345-6', 'TOTAL: 1.100', 'TOTAL GRAVADAS 10%: 1.100');
    const r = parseBest([
      { layout: 'rows', text: invoice },
      { layout: 'blocks', text: lines('NOTA DE CREDITO', 'ACME S.A.') },
    ]);
    expect(r?.parsed.nota).toBe('credito');
  });
});

describe('agreement is exact, but for the gaps that really occur', () => {
  it('refuses a total a single guaraní off its parts', () => {
    // Guaraníes are whole: printed parts add up exactly.
    for (const total of ['91.926', '91.924']) {
      const p = parseReceipt(lines(`TOTAL: ${total}`, 'TOTAL GRAVADAS 05%: 44.425', 'TOTAL GRAVADAS 10%: 47.500'));
      expect(p.totalsAgree, total).toBe(false);
    }
  });

  it('refuses a total one digit off its parts', () => {
    const p = parseReceipt(
      lines('TOTAL GS: 223.160', 'RES.347-SEDECO: 29', 'TOTAL GRAVADAS 10% GS: 146.589', 'TOTAL GRAVADAS 5% GS: 76.590'),
    );
    expect(p.totalsAgree).toBe(false);
  });

  it('accepts the Ley 347 rounding the ticket prints, read after its own "347"', () => {
    const p = parseReceipt(
      lines('TOTAL GS: 223.150', 'RES.347-SEDECO: 29', 'TOTAL GRAVADAS 10% GS: 146.589', 'TOTAL GRAVADAS 5% GS: 76.590'),
    );
    expect(p.totalsAgree).toBe(true);
  });

  it('accepts that rounding with its line unread: down to a multiple of 50, by less than 50', () => {
    const p = parseReceipt(lines('TOTAL GS: 223.150', 'TOTAL GRAVADAS 10% GS: 146.589', 'TOTAL GRAVADAS 5% GS: 76.590'));
    expect(p.totalsAgree).toBe(true);
  });

  it('refuses a gap that is not such a rounding', () => {
    // Not a multiple of 50, and above the parts rather than below them.
    for (const total of ['223.160', '223.200']) {
      const p = parseReceipt(
        lines(`TOTAL GS: ${total}`, 'TOTAL GRAVADAS 10% GS: 146.589', 'TOTAL GRAVADAS 5% GS: 76.590'),
      );
      expect(p.totalsAgree, total).toBe(false);
    }
  });

  it('refuses an IVA one digit off its gravada', () => {
    const p = parseReceipt(
      lines(
        'TOTAL: 91.925',
        'TOTAL GRAVADAS 05%: 44.425',
        'TOTAL GRAVADAS 10%: 47.500',
        'LIQUIDACION IVA 05%: 2.115',
        'LIQUIDACION IVA 10%: 4.316',
      ),
    );
    expect(p.totalsAgree).toBe(false);
  });

  it('allows a gravada computed from its IVA the rounding that computing it costs', () => {
    // 81.818 × 11 = 899.998 against a total of 900.000.
    const p = parseReceipt(lines('TOTAL A PAGAR: 900.000', 'LIQUIDACION IVA 10%: 81.818'));
    expect(p.totalsAgree).toBe(true);
    expect(p.derived).toContain('gravada10');
  });

  it('reads TOTAL IVA from the line that carries it, not the item header', () => {
    const p = parseReceipt(
      lines('CANTIDAD UNITARIO TOTAL IVA', 'TOTAL A PAGAR: 91.925', 'TOTAL IVA..........: Gs 6.433'),
    );
    expect(p.totalIva).toBe(6_433);
  });

  it("reads a rate footnoted with an asterisk, as a KuDE prints it", () => {
    const p = parseReceipt(
      lines('Total Pago. Gs 48.000', 'Gravadas 05%: Gs 0', 'Gravadas 10%: Gs 48.000', 'IVA 5%* Gs 0', 'IVA 10%: Gs 4.364'),
    );
    expect(p.iva5).toBe(0);
    expect(p.derived).not.toContain('iva5');
  });
});

describe('a footer printed in two columns (the amount, then its IVA)', () => {
  it('reads the exempt amount, not the zero in the IVA column beside it', () => {
    // A cooperative's fuel KuDE, 2026-09-16: "Exentas 300.000 0". Taken as the
    // last number on the line, the invoice came to nothing and was refused.
    const p = parseReceipt(
      lines(
        'KuDE de Factura Electrónica',
        'COOP. COLONIAS UNIDAS AGROP. IND. LTDA.',
        'RUC: 80017198-5',
        'Factura Electrónica N° : 005-005-0155739',
        'Fecha y Hora de Emisión: 16/09/2026 13:06:55',
        'Total a Pagar Gs: 300.000',
        'Liquidaciones del IVA',
        'Impuesto Importe IVA',
        'Gravadas 10% 0 0',
        'Gravadas 5% 0 0',
        'Exentas 300.000 0',
        'Total IVA 0',
      ),
    );
    expect(p.exentas).toBe(300_000);
    expect(p.total).toBe(300_000);
    expect(p.iva10).toBe(0);
    expect(p.totalsAgree).toBe(true);
    expect(p.missing).toEqual([]);
  });

  it('still reads an exempt line that prints only its amount', () => {
    expect(parseReceipt(lines('TOTAL: 50.000', 'TOTAL EXENTAS.....: Gs 50.000')).exentas).toBe(50_000);
  });
});

describe('percentages and "incluido" on total lines', () => {
  it('does not take a line that kept only its percent sign', () => {
    expect(parseReceipt(lines('TOTAL %: Gs 47.500', 'LIQUIDACION IVA 10%: Gs 4.318')).total).toBeNull();
  });

  it('takes a total that states the IVA it includes', () => {
    const p = parseReceipt(lines('TOTAL A PAGAR (IVA 10% INCLUIDO): Gs 47.500', 'LIQUIDACION IVA 10%: Gs 4.318'));
    expect(p.total).toBe(47_500);
    expect(p.totalsAgree).toBe(true);
  });

  it('takes "TOTAL IVA INCLUIDO" as the total, not as the IVA total', () => {
    const p = parseReceipt(lines('TOTAL IVA INCLUIDO: Gs 47.500', 'LIQUIDACION IVA 10%: Gs 4.318'));
    expect(p.total).toBe(47_500);
    expect(p.totalIva).toBeNull();
  });
});

describe('what a scrambled or partial page must not become', () => {
  it('is not exempt-only when the page prints a gravada or IVA label', () => {
    const p = parseReceipt(lines('TOTAL: 16', 'TOTAL EXENTAS: 16', 'TOTAL GRAVADAS 10%:', 'TOTAL IVA:'));
    expect(p.missing).toContain('IVA');
  });

  it('leaves the date undecided when two unlabelled dates disagree', () => {
    expect(parseReceipt(lines('de : 30/05/2025', '. 01/09/2026 17:48')).fechaEmision).toBeNull();
  });

  it('recognises a credit note by its CDC, when its title was lost', () => {
    const c43 = '05' + REAL_CDC.slice(2, 43);
    const note = c43 + String(cdcCheckDigit(c43));
    const p = parseReceipt(lines('VIELA S.A.', 'RUC: 80054993-7', 'Fecha de emisión: 14/02/2026', note));
    expect(p.nota).toBe('credito');
    expect(p.cdc).toBeNull();
  });

  it('recognises a credit note whose title lost its accent', () => {
    expect(parseReceipt('ACME S.A.\nNOTA DE CREDITO ELECTRONICA').nota).toBe('credito');
  });

  it("does not take the buyer's company for the issuer when the label lost its first letter", () => {
    const p = parseReceipt(lines('MINAS281 MERCADO', 'RUC: 5482866-0', 'LIENTE: AGRO SERVICIOS S.R.L.'));
    expect(p.emisorNombre).toBe('MINAS281 MERCADO');
  });
});

describe('amounts printed apart from their labels, as on a pre-printed form', () => {
  it('takes the IVA row above the labels when only one placement adds up', () => {
    // The layout the client's phone photo produced (production log, 2026-09-19).
    const p = parseReceipt(
      lines(
        'RUC: 6700626-4',
        '16 DE SEPTIEMBRE DE 2026',
        'TOTAL A PAGAR 160.000',
        '14.545 14.545',
        'I.V.A.: ( :',
        'LIQUIDACION DEL 5%) (10%) T.IVA',
      ),
    );
    expect(p.iva10).toBe(14_545);
    expect(p.iva5).toBeNull();
    expect(p.totalIva).toBe(14_545);
    expect(p.totalsAgree).toBe(true);
  });

  it('takes the row below the labels as well', () => {
    const p = parseReceipt(
      lines('TOTAL A PAGAR 160.000', 'LIQUIDACIÓN DEL I.V.A.: (5%) (10%) T.IVA:', '0 14.545 14.545'),
    );
    expect(p.iva5).toBe(0);
    expect(p.iva10).toBe(14_545);
    expect(p.totalsAgree).toBe(true);
  });

  it('does not read a lone zero as the whole IVA, however well it fits', () => {
    // Every placement of a zero "fits", because it changes nothing — and when
    // the exempt column has been misread as the total, a Gs 160.000 invoice
    // taxed at 10% went on record with no IVA and nothing flagged (review,
    // 2026-09-19). A row that carries no amount is not a reading of the IVA.
    const p = parseReceipt(
      lines('TOTAL: 50.000', 'TOTAL EXENTAS: 50.000', '0', 'LIQUIDACION DEL IVA (5%) (10%)'),
    );
    expect(p.iva5).toBeNull();
    expect(p.iva10).toBeNull();
    expect(p.missing).toContain('IVA');
  });

  it('refuses the same page when the exempt column was the total misread', () => {
    // The shape the review reproduced: the 10% IVA (14.545) sits out of the
    // window and only the 5% zero is beside the labels.
    const p = parseReceipt(
      lines(
        'CODIGO CANT./DESCRIPCION P. UNITARIO 5% 10% EXENTAS',
        '160.000',
        '0428 1 NESECER TERMICO C/4PZS. 160.000',
        'TOTAL A PAGAR 160.000',
        '14.545 14.545',
        '0',
        'LIQUIDACION DEL I.V.A.: (5%) (10%) T.IVA:',
      ),
    );
    expect(p.missing).toContain('IVA');
  });

  it('leaves the IVA unread when no placement adds up', () => {
    const p = parseReceipt(
      lines('TOTAL A PAGAR 160.000', '99.000 99.000', 'LIQUIDACION DEL (5%) (10%) T.IVA'),
    );
    expect(p.iva5).toBeNull();
    expect(p.iva10).toBeNull();
    expect(p.missing).toContain('IVA');
  });

  it('takes a total printed above its label when the footer confirms it', () => {
    const p = parseReceipt(
      lines('160.000', 'TOTAL A PAGAR', '0 14.545 14.545', 'LIQUIDACIÓN DEL I.V.A.: (5%) (10%) T.IVA:'),
    );
    expect(p.total).toBe(160_000);
    expect(p.totalsAgree).toBe(true);
  });

  it('does not take a total from above when nothing confirms it', () => {
    expect(parseReceipt(lines('99.999', 'TOTAL A PAGAR')).total).toBeNull();
  });
});

describe('an invoice in a foreign currency', () => {
  it('is recognised on a KuDE by its Moneda line', () => {
    const p = parseReceipt(lines('KuDE de Factura Electrónica', 'Moneda: Dólar americano', 'Total: 1.538,00'));
    expect(p.foreignCurrency).toBe('USD');
  });

  it('is recognised by U$S or USD beside its amounts', () => {
    expect(parseReceipt('TOTAL U$S 1.538,00').foreignCurrency).toBe('USD');
    expect(parseReceipt('Total USD: 448,00').foreignCurrency).toBe('USD');
  });

  it('is not claimed for an invoice in guaraníes', () => {
    const p = parseReceipt(lines('KuDE de Factura Electrónica', 'Moneda: Guarani', 'Total: 48.000'));
    expect(p.foreignCurrency).toBeNull();
    expect(parseReceipt(RECEIPT_B_TEXT).foreignCurrency).toBeNull();
  });

  it("is recognised by SIFEN's own names, and by a value on the line below", () => {
    // The XML calls it "US Dollar", and the KuDE prints what the XML says; a
    // rebuilt two-column row can leave the value under its label.
    expect(parseReceipt(lines('Moneda: US Dollar', 'Total: 1.538,00')).foreignCurrency).toBe('USD');
    expect(parseReceipt(lines('Moneda:', 'USD', 'Total: 1.538,00')).foreignCurrency).toBe('USD');
    expect(parseReceipt(lines('Moneda: Real', 'Total: 1.538,00')).foreignCurrency).toBe('BRL');
    expect(parseReceipt(lines('Moneda: Euro', 'Total: 1.538,00')).foreignCurrency).toBe('EUR');
  });

  it('is not claimed from a payment clause, an exchange rate or a buyer beside the label', () => {
    // Each of these refused a guaraní ticket that used to be stored right.
    const clause = 'Pagaré el importe en dólares americanos o su equivalente al cambio del día';
    expect(parseReceipt(lines(clause, 'TOTAL A PAGAR: 160.000')).foreignCurrency).toBeNull();
    expect(parseReceipt(lines('Cotizacion dolar: 7.000', 'TOTAL: 160.000')).foreignCurrency).toBeNull();
    expect(parseReceipt(lines('Moneda: Guarani Sres: DOLARES DEL ESTE SA', 'Total: 48.000')).foreignCurrency).toBeNull();
    expect(parseReceipt(lines('E-mail: usd@ventas.com.py', 'Total: 48.000')).foreignCurrency).toBeNull();
  });

  it('is carried from whichever reading of the photo found it', () => {
    // The layout that reads the Moneda line need not be the one that wins on
    // score, and no arithmetic can catch a dollar invoice read as guaraníes.
    const withCurrency = lines('Moneda: US Dollar', 'TOTAL A PAGAR: 1.538,00', 'IVA 10%: 139,82');
    const best = parseBest([
      { layout: 'rows', text: lines('TOTAL A PAGAR: 1.538,00', 'IVA 10%: 139,82') },
      { layout: 'blocks', text: withCurrency },
    ]);
    expect(best?.parsed.foreignCurrency).toBe('USD');
  });
});

describe('a gap that is not a rounding', () => {
  it('refuses parts exactly 50 Gs above the total', () => {
    // Ley 347 rounds down to a multiple of 50, so the gap is under 50; at
    // exactly 50 it is a misread digit, and the window was inclusive.
    const p = parseReceipt(
      lines('TOTAL A PAGAR 160.000', 'GRAVADAS 10%: 160.050', 'IVA 10%: 14.550'),
    );
    expect(p.totalsAgree).toBe(false);
  });

  it('refuses a talonario total a digit out from its detached IVA', () => {
    // The zero rate's derived gravada was adding 11 Gs of slack of its own,
    // and these were stored as printed. Refused now — as contradicted, or
    // with the IVA left unread, which importPhoto refuses just the same.
    // Not 160.001: a gravada read from its IVA is only known to ±6 Gs
    // (14.545 × 11 is 159.995, and 160.001 sits inside that), so a misread
    // digit that close cannot be told from the rounding. It is worth one
    // guaraní on the record.
    for (const total of ['160.010', '160.009']) {
      const p = parseReceipt(
        lines(
          `TOTAL A PAGAR ${total}`,
          '0 14.545 14.545',
          'LIQUIDACIÓN DEL I.V.A.: (5%) (10%) T.IVA:',
        ),
      );
      const refused = p.totalsAgree === false || p.missing.includes('IVA');
      expect(`${total}: ${refused}`).toBe(`${total}: true`);
    }
  });

  it('gives a zero rate no slack of its own', () => {
    // A gravada derived from an IVA of zero is exact, so it earns none of the
    // rounding tolerance a real IVA does — which was hiding a 50 Gs gap.
    const p = parseReceipt(
      lines('TOTAL A PAGAR 160.000', 'GRAVADAS 10%: 160.050', 'IVA 5%: 0', 'IVA 10%: 14.550'),
    );
    expect(p.derived).not.toContain('gravada5');
    expect(p.totalsAgree).toBe(false);
  });

  it("does not take a delivery note's date for the invoice's", () => {
    // "remisión" ends in "emisión": the date beside it scored as a labelled
    // emission date, and on a page with no other date it was the one read.
    const p = parseReceipt(
      lines(
        'ALMACEN SAN JOSE',
        'RUC: 80054993-7',
        'NOTA DE REMISIÓN: 0004521 05/09/2026',
        'TOTAL A PAGAR 160.000',
        'IVA 10%: 14.545',
      ),
    );
    expect(p.fechaEmision).toBeNull();
    // With its own date printed, that one is read.
    const q = parseReceipt(
      lines(
        'ALMACEN SAN JOSE',
        'RUC: 80054993-7',
        'NOTA DE REMISIÓN: 0004521 05/09/2026',
        'FECHA DE EMISIÓN: 18/08/2026',
        'TOTAL A PAGAR 160.000',
        'IVA 10%: 14.545',
      ),
    );
    expect(q.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-08-18');
  });

  it('still reads the talonario as printed', () => {
    const p = parseReceipt(
      lines('TOTAL A PAGAR 160.000', '0 14.545 14.545', 'LIQUIDACIÓN DEL I.V.A.: (5%) (10%) T.IVA:'),
    );
    expect(p).toMatchObject({ total: 160_000, iva5: 0, iva10: 14_545, totalsAgree: true });
  });
});
