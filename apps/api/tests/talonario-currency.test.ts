import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  amountsInWords,
  dateSeen,
  decidePhoto,
  monthOfWord,
  settledCurrency,
} from '../src/services/photo-decision';
import {
  fromExtraction,
  parseBest,
  parseReceipt,
  type Extraction,
} from '../src/services/receipt-parser';
import { aiFixture } from './fixtures/ai';

/**
 * Two handwritten talonarios the client photographed on 2026-09-21, with
 * Vision's real text — its own blocks, and the rows rebuilt from its words:
 *
 *  - Cevelio, Gs 900.000, refused four times as "dollars": its form prints
 *    "TOTAL A PAGAR ☒ Guaraníes ☐ Dólares Americanos" and the parser read the
 *    printed word, not the tick.
 *  - Residencial Domicia, a rent of USD 500 that prints no exchange rate,
 *    refused every time for the rate; its date, "Santa Rita, 31 de agosto de
 *    2026", written by hand with no "Fecha" label.
 */

const text = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', 'ocr-text', `${name}.txt`), 'utf8').trim();
const OWN_RUC = '80175384';

function talonario(name: string) {
  const blocks = text(`${name}-blocks`);
  const rows = text(`${name}-rows`);
  const reading = parseBest([
    { layout: 'rows', text: rows },
    { layout: 'blocks', text: blocks },
  ]);
  if (!reading) throw new Error(`no reading for ${name}`);
  return { parsed: reading.parsed, blocks, rows };
}

describe('a form that prints the choice of currency', () => {
  it('leaves the currency open instead of reading the printed word', () => {
    const { parsed } = talonario('cevelio-manuscrita');
    expect(parsed.foreignCurrency).toBeNull();
    expect(parsed.currencyChoice).toBe('USD');
  });

  it('is settled by the tick the model saw: Cevelio, in guaraníes', () => {
    const { parsed, blocks, rows } = talonario('cevelio-manuscrita');
    const model = fromExtraction(settledCurrency(aiFixture('cevelio-manuscrita'), parsed, blocks));
    const decision = decidePhoto(parsed, model, blocks, OWN_RUC, [rows]);

    expect(decision).toMatchObject({ kind: 'store', source: 'ai' });
    if (decision.kind !== 'store') return;
    expect(decision.reading).toMatchObject({
      foreignCurrency: null,
      total: 900_000,
      iva10: 81_818,
      emisorRuc: '6902656',
    });
    expect(decision.reading.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-08-19');
    // The letterhead's name, not a line of its printed economic activities.
    expect(decision.reading.emisorNombre).toMatch(/cevelio/i);
  });

  it('never files guaraníes as dollars on the model saying so', () => {
    const { parsed, blocks, rows } = talonario('cevelio-manuscrita');
    // Gs 900.000 in dollars would go into the IVA some six thousand times over.
    const asDollars = fromExtraction({ ...aiFixture('cevelio-manuscrita'), moneda: 'USD' });
    expect(decidePhoto(parsed, asDollars, blocks, OWN_RUC, [rows])).toMatchObject({
      kind: 'refuse',
      reason: 'moneda',
      detail: 'choice',
    });
    // Nor with no model at all: nothing then says which box is ticked.
    expect(decidePhoto(parsed, null, blocks, OWN_RUC, [rows])).toMatchObject({
      kind: 'refuse',
      reason: 'moneda',
    });
  });

  it('is in the other currency when the reading has cents, whatever the model says', () => {
    const { parsed, blocks } = talonario('domicia-usd');
    expect(parsed.currencyChoice).toBe('USD');
    // The model answered PYG, with an IVA of 45,45: guaraníes have no cents.
    const answer = aiFixture('domicia-usd');
    expect(answer.moneda).toBe('PYG');
    expect(settledCurrency(answer, parsed, blocks).moneda).toBe('USD');
    // On a page that offers no other currency, a PYG answer stands.
    expect(settledCurrency(answer, { ...parsed, currencyChoice: null }, blocks).moneda).toBe('PYG');
  });
});

describe('a dollar invoice that prints no exchange rate', () => {
  it('is stored in dollars, for importPhoto to convert at the DNIT rate', () => {
    const { parsed, blocks, rows } = talonario('domicia-usd');
    const model = fromExtraction(settledCurrency(aiFixture('domicia-usd'), parsed, blocks));
    const decision = decidePhoto(parsed, model, blocks, OWN_RUC, [rows]);

    expect(decision).toMatchObject({ kind: 'store', source: 'ai' });
    if (decision.kind !== 'store') return;
    expect(decision.reading).toMatchObject({
      foreignCurrency: 'USD',
      tipoCambio: null,
      total: 500,
      gravada10: 500,
      iva10: 45.45,
      emisorRuc: '7534875',
      emisorNombre: 'RESIDENCIAL DOMICIA',
    });
    expect(decision.reading.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('is refused when the page prints a rate no reader confirmed — that one is the law', () => {
    const { parsed, blocks, rows } = talonario('domicia-usd');
    const model = fromExtraction(settledCurrency(aiFixture('domicia-usd'), parsed, blocks));
    const printed = `${blocks}\nCotizacion: 6.027,92Gs.`;
    expect(decidePhoto(parsed, model, printed, OWN_RUC, [rows])).toMatchObject({
      kind: 'refuse',
      reason: 'moneda',
      detail: 'rate',
    });
  });
});

describe('the date filled in by hand', () => {
  it('is read through two misread letters of a long month, and never as another month', () => {
    expect(monthOfWord('ageste')).toBe(8);
    expect(monthOfWord('agasto')).toBe(8);
    expect(monthOfWord('Agosto')).toBe(8);
    expect(monthOfWord('sept')).toBe(9);
    expect(monthOfWord('setiembre')).toBe(9);
    expect(monthOfWord('julio')).toBe(7);
    // One letter from both junio and julio: neither.
    expect(monthOfWord('jutio')).toBeNull();
    expect(monthOfWord('servicios')).toBeNull();
    expect(monthOfWord('se')).toBeNull();
  });

  it("is the talonario's own date line, city first, with no label", () => {
    const { blocks, rows } = talonario('domicia-usd');
    const issued = new Date(Date.UTC(2026, 7, 31));
    // "Santa Rita, 31 de ageste de 2026" — on one line only once rebuilt.
    expect(dateSeen(rows, issued)).toBe(true);
    expect(dateSeen(blocks, issued)).toBe(false);
    // Not a month the word is not.
    expect(dateSeen(rows, new Date(Date.UTC(2026, 6, 31)))).toBe(false);
  });
});

describe('the total written out', () => {
  it('reads as the amount it says, in cents', () => {
    expect(amountsInWords('quinientos con 00/100')).toEqual([50_000]);
    expect(amountsInWords('Novecientos mil')).toEqual([90_000_000]);
    expect(amountsInWords('UN MIL, QUINIENTOS TREINTA Y OCHO CON 00/100 DOLARES')).toEqual([153_800]);
    expect(amountsInWords('dos millones trescientos mil')).toEqual([230_000_000]);
    // "un" and "dos" are words of every sentence.
    expect(amountsInWords('Cantidad impresa 100 h. un solo ejemplar, dos copias')).toEqual([]);
  });
});

describe('a wrong second reading of a talonario stores the paper, or nothing', () => {
  const scaled = (v: number | null, by: number) => (v == null ? null : Math.round(v * by * 100) / 100);
  const scale = (x: Extraction, by: number): Extraction => ({
    ...x,
    total: scaled(x.total, by),
    gravada5: scaled(x.gravada5, by),
    gravada10: scaled(x.gravada10, by),
    exentas: scaled(x.exentas, by),
    iva5: scaled(x.iva5, by),
    iva10: scaled(x.iva10, by),
    totalIva: scaled(x.totalIva, by),
    items: x.items.map((it) => ({ ...it, total: scaled(it.total, by) })),
  });
  const MISREADINGS: [string, (x: Extraction) => Extraction][] = [
    ['as read', (x) => x],
    ['in dollars', (x) => ({ ...x, moneda: 'USD' })],
    ['in guaraníes', (x) => ({ ...x, moneda: 'PYG' })],
    ['every amount ten times over', (x) => scale(x, 10)],
    ['cents read as whole', (x) => scale(x, 100)],
    ['the buyer named as the issuer', (x) => ({ ...x, emisorRuc: OWN_RUC, emisorDv: 8, receptorRuc: x.emisorRuc })],
    ['a date a month out', (x) => ({ ...x, fecha: x.fecha?.replace('-08-', '-07-') ?? null })],
    ['a factura called a credit note', (x) => ({ ...x, tipoDocumento: 'nota_credito' })],
  ];
  const PAPER = {
    'cevelio-manuscrita': { total: 900_000, iva10: 81_818, fecha: '2026-08-19', moneda: null },
    'domicia-usd': { total: 500, iva10: 45.45, fecha: '2026-08-31', moneda: 'USD' },
  } as const;

  for (const [name, paper] of Object.entries(PAPER) as [keyof typeof PAPER, (typeof PAPER)[keyof typeof PAPER]][]) {
    it(name, () => {
      const { parsed, blocks, rows } = talonario(name);
      const wrong: string[] = [];
      for (const [how, mangle] of MISREADINGS) {
        const answer = fromExtraction(settledCurrency(mangle(aiFixture(name)), parsed, blocks));
        const decision = decidePhoto(parsed, answer, blocks, OWN_RUC, [rows]);
        if (decision.kind !== 'store') continue;
        const p = decision.reading;
        const got = { total: p.total, iva10: p.iva10, fecha: p.fechaEmision?.toISOString().slice(0, 10), moneda: p.foreignCurrency };
        if (JSON.stringify(got) !== JSON.stringify({ ...paper })) wrong.push(`${how}: ${JSON.stringify(got)}`);
        if (p.emisorRuc === OWN_RUC) wrong.push(`${how}: filed as the client's own sale`);
      }
      expect(wrong).toEqual([]);
    });
  }
});

/**
 * What a review of this change found it would have stored wrong — each of
 * them refused before it. The talonarios, re-figured.
 */
describe('neither currency on the model saying so alone', () => {
  // A rent of "USD 1.000 más IVA" on Domicia's form: USD 1.100, IVA 100, the
  // total written out with no cents. In guaraníes every figure reads the same.
  const usd1100 = (s: string) =>
    s
      .replace(/alquiler comercial 5000 50000/, 'alquiler comercial 1.100 1.100')
      .replace(/^50000$/m, '1.100')
      .replace(/^5000$/m, '1.100')
      .replace(/quinientos con 00\/100/g, 'mil cien')
      .replace(/10 500100/, '10 1.100')
      .replace(/^500100$/m, '1.100')
      .replace(/% 10%\) 45\.45 ,S/, '% 10%) 100')
      .replace(/\(10%\) 45\.45/, '(10%) 100')
      .replace(/TOTAL IVA: 45,S/, 'TOTAL IVA: 100')
      .replace(/TOTAL IVA: 45$/m, 'TOTAL IVA: 100');
  const rent = (moneda: 'PYG' | 'USD' | 'BRL'): Extraction => ({
    ...aiFixture('domicia-usd'),
    moneda,
    total: 1100,
    gravada10: 1100,
    iva10: 100,
    totalIva: 100,
    items: [{ ...aiFixture('domicia-usd').items[0]!, precioUnitario: 1100, total: 1100 }],
  });

  function decide(blocks: string, rows: string, x: Extraction) {
    const parsed = parseBest([
      { layout: 'rows', text: rows },
      { layout: 'blocks', text: blocks },
    ])!.parsed;
    return decidePhoto(parsed, fromExtraction(settledCurrency(x, parsed, blocks)), blocks, OWN_RUC, [rows]);
  }

  it('does not file a dollar rent as guaraníes when the model misses the tick', () => {
    const blocks = usd1100(text('domicia-usd-blocks'));
    const rows = usd1100(text('domicia-usd-rows'));
    expect(decide(blocks, rows, rent('PYG'))).toMatchObject({ kind: 'refuse', reason: 'moneda', detail: 'choice' });
    // And the truth, with no cents to show for it, is not proven either.
    expect(decide(blocks, rows, rent('USD'))).toMatchObject({ kind: 'refuse', reason: 'moneda' });
  });

  it('takes no currency the form does not offer', () => {
    const { parsed, blocks, rows } = talonario('domicia-usd');
    const brl = fromExtraction({ ...aiFixture('domicia-usd'), moneda: 'BRL' });
    expect(decidePhoto(parsed, brl, blocks, OWN_RUC, [rows])).toMatchObject({ kind: 'refuse', detail: 'choice' });
  });

  // Cevelio's form re-figured: Gs 1.100.000, IVA 100.000 — a total a dollar
  // amount would divide the same.
  const gs1100000 = (s: string, words: string) =>
    s
      .replace(/1900\.000/g, '1.100.000')
      .replace(/900\.000/g, '1.100.000')
      .replace(/81,818/g, '100.000')
      .replace(/Novecientos mil/g, words);
  const invoice: Extraction = {
    ...aiFixture('cevelio-manuscrita'),
    total: 1_100_000,
    gravada10: 1_100_000,
    iva10: 100_000,
    totalIva: 100_000,
    items: [{ ...aiFixture('cevelio-manuscrita').items[0]!, precioUnitario: 1_100_000, total: 1_100_000 }],
  };

  it('keeps guaraníes written out "con 00/100", or on a form that prints "centavos"', () => {
    for (const [how, words] of [
      ['con 00/100', 'Un millon cien mil con 00/100'],
      ['centavos', 'Un millon cien mil centavos'],
    ]) {
      const blocks = gs1100000(text('cevelio-manuscrita-blocks'), words as string);
      const rows = gs1100000(text('cevelio-manuscrita-rows'), words as string);
      const decision = decide(blocks, rows, invoice);
      expect(`${how}: ${decision.kind === 'store' ? (decision.reading.foreignCurrency ?? 'PYG') : decision.kind}`).toBe(
        `${how}: PYG`,
      );
      // Said in dollars, it is not taken: nothing printed has cents.
      expect(decide(blocks, rows, { ...invoice, moneda: 'USD' })).toMatchObject({ kind: 'refuse' });
    }
  });

  it('does not take a rate the model worked out for evidence of dollars', () => {
    const blocks = gs1100000(text('cevelio-manuscrita-blocks'), 'Un millon cien mil');
    const rows = gs1100000(text('cevelio-manuscrita-rows'), 'Un millon cien mil');
    const computed = { ...invoice, moneda: 'USD' as const, tipoCambio: 5950, totalEnGuaranies: 1_100_000 * 5950 };
    expect(decide(blocks, rows, computed)).toMatchObject({ kind: 'refuse' });
  });

  it('never lets a printed choice override a currency a "Moneda" label states', () => {
    const lines = (...l: string[]) => l.join('\n');
    const head = ['KuDE de Factura Electrónica', 'AGROQUIMICA EJEMPLO S.A.', 'RUC: 80054993-7', 'Fecha de emisión: 18/08/2026'];
    const foot = ['Total a pagar USD 1.100,00', 'Guaraníes 6.630.712', 'Gravadas 10%: 1.100,00', 'IVA 10%: 100,00'];
    const rows = lines(...head, 'Moneda: USD', 'Condición: Contado', ...foot);
    const blocks = lines(...head, 'Moneda:', 'Condición: Contado', 'USD', ...foot);
    const parsed = parseBest([
      { layout: 'rows', text: rows },
      { layout: 'blocks', text: blocks },
    ])!.parsed;
    expect(parsed).toMatchObject({ foreignCurrency: 'USD', currencyChoice: null });
  });
});

describe('the issuer, never the buyer', () => {
  it("does not take the customer block's RUC when the station's was misread", () => {
    // "80054993-7" read as "80054998-7", whose check digit fails; the ticket
    // prints its customer in the header.
    const ticket = [
      'ESTACION DE SERVICIO EJEMPLO S.A.',
      'RUC: 80054998-7',
      'Timbrado: 16912345',
      'Cliente: TEC BIO E.A.S.',
      'RUC: 80175384-8',
      'Fecha: 20/09/2026 10:15',
      'Factura 001-002-0012345',
      'DIESEL TIPO III 50 LT 350.000',
      'TOTAL A PAGAR GS 350.000',
      'GRAVADAS 10%: 350.000',
      'IVA 10%: 31.818',
    ].join('\n');
    const parsed = parseReceipt(ticket);
    expect(parsed.emisorRuc).not.toBe(OWN_RUC);

    const model = fromExtraction({
      ...aiFixture('cevelio-manuscrita'),
      emisorNombre: 'ESTACION DE SERVICIO EJEMPLO S.A.',
      emisorRuc: '80054993',
      emisorDv: 7,
      receptorNombre: 'TEC BIO E.A.S.',
      receptorRuc: OWN_RUC,
      timbrado: '16912345',
      numeroDoc: '001-002-0012345',
      fecha: '2026-09-20',
      total: 350_000,
      gravada10: 350_000,
      iva10: 31_818,
      totalIva: 31_818,
      items: [],
    });
    const decision = decidePhoto(parsed, model, ticket, OWN_RUC);
    if (decision.kind === 'store') expect(decision.reading.emisorRuc).not.toBe(OWN_RUC);
    // Even a parser that did read the buyer as the issuer is not taken at it.
    const asIssuer = { ...parsed, emisorRuc: OWN_RUC, emisorDv: 8 };
    const again = decidePhoto(asIssuer, model, ticket, OWN_RUC);
    if (again.kind === 'store') expect(again.reading.emisorRuc).not.toBe(OWN_RUC);
  });

  it("does not file the buyer's name as the seller's", () => {
    const { parsed, blocks, rows } = talonario('cevelio-manuscrita');
    const model = fromExtraction({ ...aiFixture('cevelio-manuscrita'), emisorNombre: 'Tec Bio Solution' });
    const decision = decidePhoto(parsed, model, blocks, OWN_RUC, [rows]);
    expect(decision.kind).toBe('store');
    if (decision.kind === 'store') expect(decision.reading.emisorNombre).not.toMatch(/tec\s*bio/i);
  });
});

describe('what the parser reads off a talonario', () => {
  it('takes no exempt amount from the item table heading', () => {
    // "EXENTAS 5% 10%", signs dropped by Vision: Gs 5 exempt, on two invoices.
    const heading = parseReceipt(
      ['PROVEEDOR S.A.', 'RUC: 80054993-7', 'REG. UNITARIO EXENTAS 5 10', '588.00', 'TOTAL 1.538'].join('\n'),
    );
    expect(heading.exentas).toBeNull();
    const signs = parseReceipt(['CANTIDAD DESCRIPCIÓN EXENTAS 5% 10%', 'Exentas: 12.000'].join('\n'));
    expect(signs.exentas).toBe(12_000);
    // An amount the punctuation closes is still the amount.
    expect(parseReceipt('TOTAL EXENTAS: 300.000.-').exentas).toBe(300_000);
    expect(parseReceipt('Exentas: 20.000, Gravadas 10%: 55.000').exentas).toBe(20_000);
  });

  it("does not file the buyer's RUC, split by Vision, as the issuer's", () => {
    // "80175384-8" came back "80 175384-8"; 175384's check digit is 3.
    const p = parseReceipt(
      ['ESTACION DE SERVICIO S.A.', 'Clients TEC BIO E.A.S. RUC: 80 175384-8', 'RUC: 80054993-7'].join('\n'),
    );
    expect(p.emisorRuc).toBe('80054993');
  });
});
