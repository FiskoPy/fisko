import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  datePartlySeen,
  dateSeen,
  decidePhoto,
  digitsSeen,
  nameSeen,
  printedAmounts,
  witnessed,
} from '../src/services/photo-decision';
import {
  fromExtraction,
  parseReceipt,
  parseBest,
  type Extraction,
  type ParsedReceipt,
} from '../src/services/receipt-parser';
import { layoutsOf } from '../src/services/vision-layout';
import { aiFixture, type AiFixture } from './fixtures/ai';
import { visionFixture, type VisionFixture } from './fixtures/vision';

/**
 * Two readers, one photo. The parser reads Vision's words by the rules; a
 * vision model reads the image. This is what gets stored — and what does not.
 *
 * The photos are the client's own, with both readers' real output (see
 * tests/fixtures/vision and tests/fixtures/ai).
 */

/** The parser's best reading of a photographed ticket, and Vision's text. */
function photo(name: VisionFixture): { parsed: ParsedReceipt; text: string } {
  const annotation = visionFixture(name);
  const reading = parseBest(layoutsOf(annotation));
  if (!reading) throw new Error(`no reading for ${name}`);
  return { parsed: reading.parsed, text: annotation.text ?? '' };
}

const model = (name: AiFixture, overrides: Partial<Extraction> = {}) =>
  fromExtraction({ ...aiFixture(name), ...overrides });

/** The buyer, as every fixture masks them. */
const BUYER = '1111111';

describe('what the two readers agree on', () => {
  it.each([
    ['minas281-ticket', 'minas281', 91_925],
    ['minas281-ticket-retake', 'minas281', 91_925],
    ['fox-kude', 'fox-kude', 48_000],
    ['primavera-ticket', 'primavera', 223_150],
  ] as [VisionFixture, AiFixture, number][])('%s is stored by both', (v, a, total) => {
    const { parsed, text } = photo(v);
    const decision = decidePhoto(parsed, model(a), text, BUYER);
    expect(decision).toMatchObject({ kind: 'store', source: 'ocr+ai' });
    if (decision.kind !== 'store') return;
    expect(decision.reading.total).toBe(total);
    expect(decision.reading.iva10).toBe(parsed.iva10);
    expect(decision.reading.missing).toEqual([]);
  });

  it("keeps the parser's issuer name where the model gave an address", () => {
    const { parsed, text } = photo('minas281-ticket');
    const decision = decidePhoto(parsed, model('minas281'), text, BUYER);
    expect(decision.reading?.emisorNombre).toBe('MINAS281 MERCADO');
    // …and takes the line items, which only the model reads.
    expect(decision.reading?.items).toHaveLength(5);
  });

  it('keeps a name the model read without the phone number beside it', () => {
    const { parsed, text } = photo('rrtop-usd-kude');
    expect(parsed.emisorNombre).toBe('RR TOP AGRO E.A.S.');
    const decision = decidePhoto(parsed, model('usd-rrtop'), text, '80175384');
    expect(decision.reading?.emisorNombre).toBe('RR TOP AGRO E.A.S.');
  });
});

describe('when only one reader holds up', () => {
  it("the parser stores the talonario the model got wrong, and takes its number and item", () => {
    const { parsed, text } = photo('baratao-talonario');
    // The model put the IVA in the gravada, so its reading does not add up.
    expect(model('baratao').totalsAgree).toBe(false);
    const decision = decidePhoto(parsed, model('baratao'), text, BUYER);
    expect(decision).toMatchObject({ kind: 'store', source: 'ocr' });
    expect(decision.reading).toMatchObject({
      total: 160_000,
      iva10: 14_545,
      numeroDoc: '001-001-0192529', // read by the model, printed in the text
    });
    expect(decision.reading?.items).toHaveLength(1);
  });

  it('the dollar invoice is stored in dollars, at the rate the model read', () => {
    const { parsed, text } = photo('rrtop-usd-kude');
    // Alone, the parser refuses it: dollars with no exchange rate.
    expect(decidePhoto(parsed, null, text, '80175384')).toMatchObject({
      kind: 'refuse',
      reason: 'moneda',
    });

    const decision = decidePhoto(parsed, model('usd-rrtop'), text, '80175384');
    expect(decision).toMatchObject({ kind: 'store', source: 'ai' });
    expect(decision.reading).toMatchObject({
      foreignCurrency: 'USD',
      tipoCambio: 6_027.92,
      total: 1_538,
      iva10: 139.82,
      emisorRuc: '80156877',
      receptorRuc: '80175384',
    });
    expect(decision.reading?.items).toHaveLength(3);
  });
});

describe('what one reader saw that the other cannot overrule', () => {
  it('a dollar invoice the model read as guaraníes is refused, not stored as Gs 1.538', () => {
    const { parsed, text } = photo('rrtop-usd-kude');
    const asGuaranies = model('usd-rrtop', { moneda: 'PYG', tipoCambio: null, totalEnGuaranies: null });
    expect(asGuaranies.total).toBe(1_538);
    expect(asGuaranies.totalsAgree).toBe(true); // it adds up — in the wrong currency

    const decision = decidePhoto(parsed, asGuaranies, text, '80175384');
    expect(decision).toMatchObject({ kind: 'refuse', reason: 'moneda', detail: 'currencies' });
  });

  it('a guaraní ticket the model read as dollars is refused too', () => {
    const { parsed, text } = photo('minas281-ticket');
    const asDollars = model('minas281', {
      moneda: 'USD',
      tipoCambio: 7_000,
      totalEnGuaranies: 91_925 * 7_000,
    });
    expect(asDollars.tipoCambio).toBe(7_000);
    expect(decidePhoto(parsed, asDollars, text, BUYER)).toMatchObject({
      kind: 'refuse',
      reason: 'moneda',
    });
  });

  it('a note either reader recognises is refused, whatever the other reads', () => {
    const { parsed, text } = photo('minas281-ticket');
    expect(decidePhoto(parsed, model('minas281', { tipoDocumento: 'nota_credito' }), text, BUYER)).toMatchObject({
      kind: 'refuse',
      reason: 'nota',
    });
    expect(decidePhoto({ ...parsed, nota: 'debito' }, model('minas281'), text, BUYER)).toMatchObject({
      kind: 'refuse',
      reason: 'nota',
    });
  });

  it('two sound readings with different amounts store neither', () => {
    const { parsed, text } = photo('minas281-ticket');
    const other = model('minas281', {
      total: 91_000,
      gravada5: 44_425,
      gravada10: 46_575,
      iva10: 4_234,
      totalIva: 6_349,
    });
    expect(other.totalsAgree).toBe(true);
    expect(decidePhoto(parsed, other, text, BUYER)).toMatchObject({
      kind: 'refuse',
      reason: 'lecturas',
      detail: 'amounts',
    });
  });

  const INVOICE = [
    'VIELA S.A.',
    'RUC: 80054993-7',
    'Timbrado: 12345678',
    'Factura Electrónica: 005-005-0141150',
    'Fecha de emisión: 14/02/2026',
    'Vence el 20/03/2026',
    'Total Pago. Gs 237.500',
    'Gravadas 10%: Gs 237.500',
    'IVA 10%: Gs 21.591',
  ];

  it('the day it falls due is not the day it was issued', () => {
    // The model took the due date for the emission date; it is printed, but
    // as what it is, so the invoice keeps the date the parser read.
    const text = INVOICE.join('\n');
    const ai = fromExtraction({
      ...aiFixture('minas281'),
      emisorRuc: '80054993',
      emisorDv: 7,
      numeroDoc: '005-005-0141150',
      fecha: '2026-03-20',
      total: 237_500,
      gravada5: 0,
      iva5: 0,
      gravada10: 237_500,
      iva10: 21_591,
      totalIva: 21_591,
      items: [],
    });
    const decision = decidePhoto(parseReceipt(text), ai, text, BUYER);
    expect(decision).toMatchObject({ kind: 'store' });
    expect(decision.reading?.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-02-14');
  });

  it('two dates both printed as the emission date store neither', () => {
    // One photo of two invoices, or a reprint over the original.
    const text = [...INVOICE, 'Fecha de emisión: 20/03/2026'].join('\n');
    const parsed = parseReceipt(text);
    expect(parsed.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-02-14');

    const ai = fromExtraction({
      ...aiFixture('minas281'),
      emisorRuc: '80054993',
      emisorDv: 7,
      numeroDoc: '005-005-0141150',
      fecha: '2026-03-20',
      total: 237_500,
      gravada5: 0,
      iva5: 0,
      gravada10: 237_500,
      iva10: 21_591,
      totalIva: 21_591,
      items: [],
    });
    expect(ai.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-03-20');
    expect(decidePhoto(parsed, ai, text, BUYER)).toMatchObject({
      kind: 'refuse',
      reason: 'lecturas',
      detail: 'dates',
    });
  });
});

describe('the model alone is held to what Vision saw', () => {
  const TEXT = [
    'VIELA S.A.',
    'RUC 80054993-7',
    '005-005-0141150',
    '14/02/2026',
    '33.500 204.000',
    '1.595 18.545',
    '237.500',
  ].join('\n');
  const answer = (overrides: Partial<Extraction> = {}): Extraction => ({
    ...aiFixture('minas281'),
    emisorNombre: 'VIELA S.A.',
    emisorRuc: '80054993',
    emisorDv: 7,
    timbrado: '12345678',
    numeroDoc: '005-005-0141150',
    fecha: '2026-02-14',
    total: 237_500,
    gravada5: 33_500,
    gravada10: 204_000,
    iva5: 1_595,
    iva10: 18_545,
    totalIva: 20_140,
    exentas: null,
    items: [],
    ...overrides,
  });

  it('rescues a layout the parser could not read', () => {
    const parsed = parseReceipt(TEXT);
    expect(parsed.total).toBeNull(); // no label the parser knows

    const decision = decidePhoto(parsed, fromExtraction(answer()), TEXT, BUYER);
    expect(decision).toMatchObject({ kind: 'store', source: 'ai' });
    expect(decision.reading).toMatchObject({
      emisorRuc: '80054993',
      total: 237_500,
      iva5: 1_595,
      iva10: 18_545,
      timbrado: null, // the model read a timbrado Vision never saw
    });
  });

  it('refuses a taxed invoice the model called fully exempt', () => {
    // Exentas absorbs the whole total and still adds up, so no arithmetic
    // objects: the page has to carry the word. Otherwise a Gs 237.500 invoice
    // taxed at 10% goes on record with no IVA at all.
    const asExempt = fromExtraction(
      answer({ exentas: 237_500, gravada5: null, gravada10: null, iva5: 0, iva10: 0, totalIva: 0 }),
    );
    expect(asExempt.totalsAgree).toBe(true);
    expect(asExempt.missing).not.toContain('IVA'); // exempt-only reads as complete
    expect(witnessed(asExempt, TEXT, BUYER).seen).toBe(false);
    // The genuinely exempt invoice says so on the paper.
    expect(witnessed(asExempt, `${TEXT}\nTOTAL EXENTAS: 237.500`, BUYER).seen).toBe(true);
  });

  it('compares the amounts even when the model lost its date', () => {
    // witnessed() drops a date the text does not show, which used to make the
    // whole reading "unsound" and quietly skip the comparison — so a model
    // reading that contradicted the parser was ignored instead of refusing.
    const { parsed, text } = photo('minas281-ticket');
    const contradicting = model('minas281', {
      fecha: '2026-09-20', // not printed anywhere: witnessed drops it
      total: 91_000,
      gravada5: 44_425,
      gravada10: 46_575,
      iva10: 4_234,
      totalIva: 6_349,
    });
    expect(witnessed(contradicting, text, BUYER).reading.fechaEmision).toBeNull();
    expect(decidePhoto(parsed, contradicting, text, BUYER)).toMatchObject({
      kind: 'refuse',
      reason: 'lecturas',
      detail: 'amounts',
    });
  });

  it('blames the field that actually stopped it, not the parser', () => {
    // The model read the amounts and they are all in the text; only its date
    // could not be confirmed. Saying "no pudimos leer el total" sent the user
    // to re-photograph the half of the page that had been read fine.
    const unconfirmedDate = fromExtraction(answer({ fecha: '2026-02-20' }));
    const parsed = parseReceipt(TEXT);
    expect(parsed.total).toBeNull();
    const decision = decidePhoto(parsed, unconfirmedDate, TEXT, BUYER);
    expect(decision).toMatchObject({ kind: 'refuse', reason: 'fecha', detail: 'ai:fecha' });
  });

  it('refuses amounts the text does not show, however well they add up', () => {
    const invented = answer({ total: 240_000, gravada10: 206_500, iva10: 18_773, totalIva: 20_368 });
    const reading = fromExtraction(invented);
    expect(reading.totalsAgree).toBe(true);

    const decision = decidePhoto(parseReceipt(TEXT), reading, TEXT, BUYER);
    expect(decision).toMatchObject({ kind: 'refuse', detail: 'ai:unseen' });
  });

  it('refuses a tax figure the model worked out instead of reading', () => {
    // gravada10 asserted equal to the total mints an IVA of total/11 that is
    // on no line of the page, and one printed number — the total — would
    // authorise it. A fully exempt invoice read this way would be taxed.
    const guessed = fromExtraction(answer({ gravada10: 237_500, iva10: null, gravada5: null, iva5: null, totalIva: null, exentas: null }));
    expect(guessed.totalsAgree).toBe(true); // it adds up, by construction
    expect(guessed.iva10).toBe(21_591);
    expect(witnessed(guessed, TEXT, BUYER).seen).toBe(false);
    expect(decidePhoto(parseReceipt(TEXT), guessed, TEXT, BUYER)).toMatchObject({ kind: 'refuse' });
  });

  it('refuses an exchange rate whose guaraní total is not printed', () => {
    const text = `${TEXT}\nCotizacion: 7.000`;
    const invented = fromExtraction({
      ...answer(),
      moneda: 'USD',
      tipoCambio: 7_000,
      totalEnGuaranies: 237_500 * 7_000,
    });
    expect(invented.tipoCambio).toBe(7_000); // the model's own figures agree
    expect(witnessed(invented, text, BUYER).seen).toBe(false);
  });

  it('keeps no line item the page does not show, amount and wording', () => {
    const items = [
      { descripcion: 'PERFUME IMPORTADO 100ML', cantidad: 1, precioUnitario: 200_000, total: 200_000, tasaIva: 10 },
      { descripcion: 'SET DE COPAS', cantidad: 1, precioUnitario: 37_500, total: 37_500, tasaIva: 10 },
    ];
    // They add up to the total exactly; neither amount is printed.
    expect(items.reduce((s, it) => s + it.total, 0)).toBe(237_500);
    const { reading } = witnessed(fromExtraction(answer({ items })), TEXT, BUYER);
    expect(reading.items).toEqual([]);

    // An amount that is printed, under a description that is not.
    const disguised = [{ descripcion: 'PERFUME IMPORTADO', cantidad: 1, precioUnitario: 237_500, total: 237_500, tasaIva: 10 }];
    expect(witnessed(fromExtraction(answer({ items: disguised })), TEXT, BUYER).reading.items).toEqual([]);
  });

  it('keeps no name the page does not show', () => {
    const { reading } = witnessed(
      fromExtraction(answer({ emisorNombre: 'DISTRIBUIDORA INVENTADA SRL', receptorNombre: 'CLIENTE INVENTADO' })),
      TEXT,
      BUYER,
    );
    expect(reading.emisorNombre).toBeNull();
    expect(reading.receptorNombre).toBeNull();
    expect(reading.missing).toContain('Nombre del emisor');
  });

  it('files the invoice as a purchase when the model names the buyer as the issuer and no one else', () => {
    // With no seller to swap in, the issuer is left unread: naming the user as
    // the issuer turns a purchase into a sale, and its IVA from credit to debit.
    const swapped = witnessed(
      fromExtraction(answer({ emisorRuc: BUYER, emisorDv: 9, emisorNombre: 'XXXXX XXXXX', receptorRuc: null, cdc: null })),
      `${TEXT}\nCI: 1111111-9`,
      BUYER,
    );
    expect(swapped.reading.emisorRuc).toBeNull();
    expect(swapped.reading.receptorRuc).toBe(BUYER);
  });

  it('turns it back around by the buyer the parser read, with no RUC on the profile', () => {
    // Most users have no RUC saved. The receptor block of the page names the
    // buyer just as well, and filing him as the issuer makes the purchase a
    // sale — its IVA moves from credit to debit.
    const swapped = fromExtraction(
      answer({ emisorRuc: BUYER, emisorDv: 9, emisorNombre: 'XXXXX XXXXX', receptorRuc: '80054993', receptorNombre: 'VIELA S.A.', cdc: null }),
    );
    const asRead = { ...parseReceipt(TEXT), receptorRuc: BUYER } as ParsedReceipt;
    const { reading } = witnessed(swapped, `${TEXT}\nCI: 1111111-9`, null, asRead);
    expect(reading).toMatchObject({ emisorRuc: '80054993', emisorNombre: 'VIELA S.A.', receptorRuc: BUYER });
  });

  it('leaves the issuer unread when nothing says which party the model named', () => {
    const single = fromExtraction(
      answer({ emisorRuc: BUYER, emisorDv: 9, emisorNombre: 'XXXXX XXXXX', receptorRuc: null, cdc: null }),
    );
    const blind = { ...parseReceipt(TEXT), emisorRuc: null, receptorRuc: null } as ParsedReceipt;
    const { reading } = witnessed(single, `${TEXT}\nCI: 1111111-9`, null, blind);
    expect(reading.emisorRuc).toBeNull();
    expect(reading.missing).toContain('RUC del emisor');
  });

  it("files the name that goes with the RUC, not the other party's", () => {
    // The model swapped the parties and its own RUC was dropped, so only its
    // receptorNombre belongs to the RUC being filed.
    const ocr = { ...parseReceipt(TEXT), emisorRuc: '80054993', emisorDv: 7, emisorNombre: null } as ParsedReceipt;
    const swapped = fromExtraction(
      answer({ emisorRuc: null, emisorDv: null, emisorNombre: 'CLIENTE COMPRADOR', receptorRuc: '80054993', receptorNombre: 'VIELA S.A.', cdc: null }),
    );
    const decision = decidePhoto(ocr, swapped, TEXT, BUYER);
    expect(decision.reading?.emisorNombre).not.toBe('CLIENTE COMPRADOR');
  });

  it('turns the invoice back around when the model names the buyer as the issuer', () => {
    const swapped = witnessed(
      fromExtraction(answer({ emisorRuc: BUYER, emisorDv: 9, emisorNombre: 'XXXXX XXXXX', receptorRuc: '80054993', receptorNombre: 'VIELA S.A.', cdc: null })),
      `${TEXT}\nCI: 1111111-9`,
      BUYER,
    );
    expect(swapped.reading).toMatchObject({
      emisorRuc: '80054993',
      emisorNombre: 'VIELA S.A.',
      receptorRuc: BUYER,
    });
  });

  it('drops a date, a number and a RUC the text does not show', () => {
    const { reading } = witnessed(
      fromExtraction(answer({ fecha: '2026-02-15', numeroDoc: '005-005-0999999', emisorRuc: '80054994', emisorDv: 5, cdc: null })),
      TEXT,
      BUYER,
    );
    expect(reading).toMatchObject({ fechaEmision: null, numeroDoc: null, emisorRuc: null });
    expect(reading.missing).toEqual(expect.arrayContaining(['RUC del emisor', 'Fecha']));
  });
});

describe('reading the text for what it shows', () => {
  it('reads an amount however its separators are printed', () => {
    const cents = printedAmounts('Total 1.538,00 y 139,82 y 160.000 y 1,538.00 y 9.270.941');
    for (const v of [1_538, 139.82, 160_000, 9_270_941]) expect(cents.has(Math.round(v * 100))).toBe(true);
    expect(cents.has(Math.round(1_537 * 100))).toBe(false);
  });

  it('takes the emission label the rebuilt rows left on the line above', () => {
    // A KuDE prints "Emisión." and its date on separate rows (fox-kude), and
    // requiring the label on the date's own line lost the model's reading.
    const kude = photo('fox-kude');
    expect(dateSeen(kude.text, new Date(Date.UTC(2026, 8, 1)))).toBe(true);
    // …but the due date of the dollar KuDE is still not the emission date,
    // nor is a lot's manufacturing date or a timbrado's validity.
    const usd = photo('rrtop-usd-kude');
    expect(dateSeen(usd.text, new Date(Date.UTC(2026, 7, 18)))).toBe(true); // emission
    expect(dateSeen(usd.text, new Date(Date.UTC(2026, 8, 18)))).toBe(false); // vencimiento
    expect(dateSeen(usd.text, new Date(Date.UTC(2026, 3, 30)))).toBe(false); // lote, FAB.
    const minas = photo('minas281-ticket');
    expect(dateSeen(minas.text, new Date(Date.UTC(2026, 8, 2)))).toBe(true); // emission
    expect(dateSeen(minas.text, new Date(Date.UTC(2025, 10, 28)))).toBe(false); // vigencia
    expect(dateSeen(minas.text, new Date(Date.UTC(2026, 10, 30)))).toBe(false); // válido hasta
  });

  it('takes a talonario date written out with no label at all', () => {
    // "16 DE SEPTIEMBRE DE 2026", on a form whose other dates are the
    // timbrado's vigencia — which the page names, so they are not rivals for
    // it. Requiring the only date on the page cost this one.
    const talonario = photo('baratao-talonario');
    expect(dateSeen(talonario.text, new Date(Date.UTC(2026, 8, 16)))).toBe(true);
    expect(dateSeen(talonario.text, new Date(Date.UTC(2026, 2, 31)))).toBe(false); // vigencia
    expect(dateSeen(talonario.text, new Date(Date.UTC(2027, 2, 31)))).toBe(false); // fin de vigencia
  });

  it('refuses a date whose rival label the rebuilt rows left on the line above', () => {
    // The same split that puts "Emisión." above its date puts "Fecha Inicio
    // Vigencia" above its own, and an unlabelled date has nothing else to go
    // on. Filed as the emission date, a September purchase lands in March.
    const rows = (visionFixture('baratao-talonario').text ?? '').split('\n');
    const split = [...rows.slice(0, 19), 'Fecha Inicio Vigencia', '31/03/2026', ...rows.slice(20)].join('\n');
    expect(dateSeen(split, new Date(Date.UTC(2026, 2, 31)))).toBe(false);
    expect(dateSeen('VENCIMIENTO\n30/11/2026\nTOTAL 160.000', new Date(Date.UTC(2026, 10, 30)))).toBe(false);
    // …but a labelled emission date beside a due date is still the emission date.
    expect(
      dateSeen('FECHA DE EMISIÓN: 18/08/2026\nVENCIMIENTO 18/09/2026', new Date(Date.UTC(2026, 7, 18))),
    ).toBe(true);
  });

  it('refuses the dates of other documents and other events on the page', () => {
    const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
    // "remisión" ends in "emisi": a delivery note's date is not this invoice's.
    expect(dateSeen('NOTA DE REMISIÓN: 0004521 05/09/2026', day(2026, 9, 5))).toBe(false);
    expect(dateSeen('NOTA DE REMISION\n05/09/2026', day(2026, 9, 5))).toBe(false);
    // The block the buyer signs and dates, on a credit invoice.
    expect(dateSeen('Recibí conforme las mercaderías\nFecha 20/10/2026\nFirma del Cliente', day(2026, 10, 20))).toBe(false);
    // How a due date is abbreviated in practice.
    for (const line of ['VTO. 30/11/2026', 'VENC.: 30/11/2026', 'Vcto 30/11/2026', 'EXPIRA 30/11/2026', 'V. 30/11/2026']) {
      expect(`${line} -> ${dateSeen(`FACTURA\n${line}\nTOTAL 160.000`, day(2026, 11, 30))}`).toBe(`${line} -> false`);
    }
    // …without refusing an emission date printed beside a timbrado, a street
    // address or an issuer whose name happens to start with "FABRICA".
    expect(dateSeen('TIMBRADO: 18479784 FECHA: 02/09/2026', day(2026, 9, 2))).toBe(true);
    expect(dateSeen('FABRICA DE PASTAS S.A.\nFECHA DE EMISIÓN: 02/09/2026', day(2026, 9, 2))).toBe(true);
    expect(dateSeen('AV. MCAL LOPEZ 1234\nFECHA DE EMISIÓN: 02/09/2026', day(2026, 9, 2))).toBe(true);
  });

  it('takes a handwritten date that Vision scattered below its label', () => {
    // A talonario filled in by hand (Cevelio, 2026-09-20): "19 de." under the
    // label, "Agosto" on the next row, and "de 20.26" far down the page. The
    // model read 2026-08-19 right, and the witness dropped it.
    const text = readFileSync(join(__dirname, 'fixtures', 'ocr-text', 'cevelio-manuscrita.txt'), 'utf8');
    expect(dateSeen(text, new Date(Date.UTC(2026, 7, 19)))).toBe(true);
    // Not another day, not another month — and not the vigencia beside it.
    expect(dateSeen(text, new Date(Date.UTC(2026, 7, 18)))).toBe(false);
    expect(dateSeen(text, new Date(Date.UTC(2026, 8, 19)))).toBe(false);
    expect(dateSeen(text, new Date(Date.UTC(2026, 5, 8)))).toBe(false);
    expect(dateSeen(text, new Date(Date.UTC(2026, 8, 30)))).toBe(false);
  });

  it('stores that handwritten talonario from the model, with the date it bears', () => {
    const text = readFileSync(join(__dirname, 'fixtures', 'ocr-text', 'cevelio-manuscrita.txt'), 'utf8');
    const ai = fromExtraction({
      ...aiFixture('minas281'),
      emisorNombre: 'CEVELIO SERVICIO GENERALES Y METALURGICA',
      emisorRuc: '6902656',
      emisorDv: 4,
      receptorNombre: 'Tec Bio Solution',
      receptorRuc: '80175384',
      timbrado: '18908353',
      numeroDoc: '001-001-0000071',
      fecha: '2026-08-19',
      total: 900_000,
      gravada5: null,
      gravada10: 900_000,
      exentas: null,
      iva5: null,
      iva10: 81_818,
      totalIva: 81_818,
      redondeo: null,
      items: [{ descripcion: 'Fabricacion de puerta', cantidad: 1, precioUnitario: 900_000, total: 900_000, tasaIva: 10 }],
    });
    const decision = decidePhoto(parseReceipt(text), ai, text, '80175384');
    expect(decision).toMatchObject({ kind: 'store', source: 'ai' });
    expect(decision.reading).toMatchObject({ total: 900_000, iva10: 81_818, emisorRuc: '6902656' });
    expect(decision.reading?.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  it('reads a month written by hand through one misread letter', () => {
    // Vision loses a letter of a word filled in by hand often enough that
    // refusing over it costs an invoice whose every figure was verified.
    const page = (linea: string) =>
      [
        'CEVELIO SERVICIO GENERALES Y METALURGICA',
        'TIMBRADO N° 18908353',
        'Fecha inicio vigencia 08/06/2026',
        'Fecha fin vigencia 30/09/2026',
        linea,
        'TOTAL A PAGAR 900.000',
      ].join('\n');
    const day = new Date(Date.UTC(2026, 7, 19));

    for (const mes of ['Agosto', 'Agasto', 'Agost']) {
      expect(`${mes}: ${dateSeen(page(`Fecha de Emisión: 19 de. ${mes} de 20.26`), day)}`).toBe(
        `${mes}: true`,
      );
    }

    // One letter is not a licence to read another month: junio and julio are
    // one apart, and the month is the period the IVA is declared in.
    const junio = page('Fecha de Emisión: 19 de. Junio de 20.26');
    expect(dateSeen(junio, new Date(Date.UTC(2026, 6, 19)))).toBe(false);
    expect(dateSeen(junio, new Date(Date.UTC(2026, 5, 19)))).toBe(true);
  });

  it('keeps a date whose month is illegible, and says to check it', () => {
    const text = [
      'CEVELIO SERVICIO GENERALES Y METALURGICA',
      'Fecha inicio vigencia 08/06/2026',
      'Fecha de Emisión: 19 de. Xgqsfo de 20.26 Condición de Venta',
      'TOTAL A PAGAR 900.000',
      'LIQUIDACIÓN DEL : 5%) ( ) 81,818 TOTAL IVA: 81,818',
    ].join('\n');
    const day = new Date(Date.UTC(2026, 7, 19));
    expect(dateSeen(text, day)).toBe(false);
    expect(datePartlySeen(text, day)).toBe(true);

    const ai = fromExtraction({
      ...aiFixture('minas281'),
      emisorNombre: 'CEVELIO SERVICIO GENERALES Y METALURGICA',
      emisorRuc: '6902656',
      emisorDv: 4,
      receptorRuc: '80175384',
      timbrado: null,
      numeroDoc: null,
      fecha: '2026-08-19',
      total: 900_000,
      gravada5: null,
      gravada10: 900_000,
      exentas: null,
      iva5: null,
      iva10: 81_818,
      totalIva: 81_818,
      items: [],
    });
    const { reading } = witnessed(ai, text, '80175384', null);
    expect(reading.fechaEmision?.toISOString().slice(0, 10)).toBe('2026-08-19');
    expect(reading.missing).toContain('Fecha (confirmá el mes)');

    // …and it is stored, not turned away.
    expect(decidePhoto(parseReceipt(text), ai, text, '80175384')).toMatchObject({
      kind: 'store',
      source: 'ai',
    });
  });

  it('reads a date however it is printed', () => {
    const d = new Date(Date.UTC(2026, 7, 18));
    for (const text of ['18/08/2026', '18-8-26', '2026-08-18', '18 de agosto de 2026', 'emitida el 18.08.2026']) {
      expect(dateSeen(text, d)).toBe(true);
    }
    for (const text of ['19/08/2026', '18/09/2026', '180820260']) expect(dateSeen(text, d)).toBe(false);
  });

  it('finds digits printed with separators, and not inside a longer number', () => {
    expect(digitsSeen('RUC: 80.156.877-3', '80156877')).toBe(true);
    expect(digitsSeen('CDC 0180 1568 7730', '018015687730')).toBe(true);
    expect(digitsSeen('Factura 001-001-0000637', '0000637')).toBe(true);
    // Not a number that merely contains them.
    expect(digitsSeen('CDC 0180 1568 7730', '0180156877')).toBe(false);
    expect(digitsSeen('Nro 1801568771', '80156877')).toBe(false);
    // Nor an amount whose thousands separator happens to line up: a total of
    // 1.637 vouched for document number 0000637.
    expect(digitsSeen('TOTAL 1.637', '0000637')).toBe(false);
    expect(digitsSeen('TOTAL 223.150', '0000150')).toBe(false);
  });

  it('finds a name through a misread letter, and a short one written as a run', () => {
    // Vision read "CFBOLLA" where the paper says "CEBOLLA".
    expect(nameSeen('11377 FYV CFBOLLA KG', 'FYV CEBOLLA KG')).toBe(true);
    expect(nameSeen('NOMBRE: TEC BIO E.AS.', 'TEC BIO E.A.S')).toBe(true);
    expect(nameSeen('11377 FYV CFBOLLA KG', 'PERFUME IMPORTADO')).toBe(false);
    // One letter, not two.
    expect(nameSeen('ALMACEN CFBXLLA', 'CEBOLLA')).toBe(false);
  });
});
