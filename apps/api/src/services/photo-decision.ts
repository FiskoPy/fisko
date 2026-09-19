import { calcRucDv } from '../utils/ruc';
import type { ParsedItem, ParsedReceipt } from './receipt-parser';

/**
 * Which reading of a photo is stored, if any.
 *
 * Two independent readers look at every photo: the OCR text through the
 * rules parser, and a vision-language model (see ai-reader). Each reading has
 * already been held to the invoice's own arithmetic. What is left:
 *   - what either reader saw that no reading of the amounts overrules: a
 *     credit or debit note, a foreign currency, and two different dates;
 *   - both sound and naming the same amounts: store the parser's, completed
 *     with what only the model read (line items, a number the parser missed);
 *   - both sound, different amounts: one of them is wrong and nothing says
 *     which, so neither is stored;
 *   - only the parser sound: store it, as before there was a model;
 *   - only the model sound: store it only if Vision saw its figures too. A
 *     language model can write a plausible number that is not on the paper,
 *     and its numbers can add up; the OCR text of the same photo is a witness
 *     it cannot write. What it read that the text does not show is dropped,
 *     and an amount the text does not show refuses the photo;
 *   - neither: refuse, with the parser's reason — its messages are the ones
 *     the user has learned — or the model's when the parser saw nothing.
 */

export type Refusal = 'nota' | 'moneda' | 'total' | 'contradiccion' | 'iva' | 'fecha' | 'lecturas';

export type PhotoSource = 'ocr' | 'ai' | 'ocr+ai';

export type PhotoDecision =
  | { kind: 'store'; reading: ParsedReceipt; source: PhotoSource }
  | { kind: 'refuse'; reason: Refusal; reading: ParsedReceipt | null; detail?: string };

/** Why importPhoto would refuse this reading on its own, or null. */
export function refusalOf(p: ParsedReceipt): Refusal | null {
  if (p.nota) return 'nota';
  if (p.foreignCurrency && p.tipoCambio == null) return 'moneda';
  if (p.total == null) return 'total';
  if (p.totalsAgree === false) return 'contradiccion';
  if (p.missing.includes('IVA')) return 'iva';
  if (p.fechaEmision == null) return 'fecha';
  return null;
}

/**
 * Whether a reading's AMOUNTS stand on their own, whatever its identifiers
 * say. witnessed() drops a date, a RUC or a name the text does not show and
 * never touches the figures, so a reading it stripped of its date still has
 * something to say about the amounts — and either contradicts the other
 * reader or does not.
 */
export function amountsSound(p: ParsedReceipt): boolean {
  if (p.nota || p.total == null || p.totalsAgree === false) return false;
  if (p.foreignCurrency && p.tipoCambio == null) return false;
  // With no tax figure there is nothing to compare: sameAmounts reads a null
  // IVA as zero and would refuse a total the two readers agree on.
  return !p.missing.includes('IVA');
}

const unitOf = (p: ParsedReceipt): number => (p.foreignCurrency ? 0.01 : 1);

/** Whether two sound readings name the same invoice amounts. */
export function sameAmounts(a: ParsedReceipt, b: ParsedReceipt): boolean {
  if ((a.foreignCurrency ?? 'PYG') !== (b.foreignCurrency ?? 'PYG')) return false;
  const unit = Math.max(unitOf(a), unitOf(b));
  const close = (x: number | null, y: number | null) => Math.abs((x ?? 0) - (y ?? 0)) <= unit + 1e-9;
  return close(a.total, b.total) && close(a.iva5, b.iva5) && close(a.iva10, b.iva10);
}

/**
 * The model's items, if they account for this reading's amounts: their sum is
 * its total (the Ley 347 rounding aside), and per rate they match its
 * gravadas where those are known. Otherwise none — an item list that does not
 * add up is not the invoice's.
 */
export function itemsFitting(reading: ParsedReceipt, items: ParsedItem[]): ParsedItem[] {
  if (!items.length || reading.total == null) return [];
  const unit = unitOf(reading);
  const near = (sum: number, target: number, derived: boolean) => {
    const gap = sum - target;
    const slack = unit * items.length + (derived ? 11 * unit : 0) + 1e-9;
    if (Math.abs(gap) <= slack) return true;
    // Items are priced before the Ley 347 rounding takes up to 49 Gs off.
    return unit === 1 && gap > 0 && gap < 50 + slack;
  };
  const sum = items.reduce((s, it) => s + it.total, 0);
  if (!near(sum, reading.total, false)) return [];
  for (const rate of [5, 10] as const) {
    const g = reading[`gravada${rate}`];
    if (g == null) continue;
    const byRate = items.filter((it) => it.ivaRate === rate).reduce((s, it) => s + it.total, 0);
    if (!near(byRate, g, reading.derived.includes(`gravada${rate}`))) return [];
  }
  return items;
}

// ---------------------------------------------------------------------------
// What the OCR text shows

/**
 * Every number in the text, in cents, read both ways its separators can go:
 * all of them as thousands ("160.000"), or the last one as the decimal point
 * when one or two digits follow it ("1.538,00", "1,538.00", "139,82").
 */
export function printedAmounts(text: string): Set<number> {
  const out = new Set<number>();
  for (const token of text.match(/\d(?:[\d.,]*\d)?/g) ?? []) {
    out.add(Number(token.replace(/\D/g, '')) * 100);
    const decimal = token.match(/^(.*\d)[.,](\d{1,2})$/);
    if (decimal) {
      out.add(Math.round(Number(`${(decimal[1] as string).replace(/\D/g, '')}.${decimal[2]}`) * 100));
    }
  }
  return out;
}

/**
 * Whether these digits are printed in the text as a whole number of their own
 * — "80.156.877-3" for a RUC, a CDC in groups of four, "0000637" for "637".
 *
 * As a number of its own: a document number ending 637 is not witnessed by a
 * total of 1.637, which is how a printed amount used to vouch for it.
 */
export function digitsSeen(text: string, digits: string): boolean {
  const target = digits.replace(/\D/g, '').replace(/^0+/, '');
  if (!target) return false;
  for (const run of text.match(/\d[\d.\s]*\d|\d/g) ?? []) {
    // The run as printed, and closed up across the spaces of a grouped CDC.
    const pieces = [run.replace(/[.\s]/g, ''), ...run.split(/\s+/).map((p) => p.replace(/\./g, ''))];
    if (pieces.some((p) => p.replace(/^0+/, '') === target)) return true;
  }
  return false;
}

/**
 * Whether the text names this: one word of it, of four letters or more, is
 * printed. The model reads a name off the image and Vision misreads a letter
 * of it ("ACRUZ" for "ACRUX"), so one word standing is the test.
 */
export function nameSeen(text: string, name: string | null): boolean {
  return namedIn(printedWordsOf(text), name);
}

/** The words of the text, and the text as one run of letters. */
function printedWordsOf(text: string): { set: Set<string>; run: string } {
  const all = words(text);
  return { set: new Set(all.split(' ')), run: all.replace(/ /g, '') };
}

function namedIn(printed: { set: Set<string>; run: string }, name: string | null): boolean {
  if (!name) return false;
  const parts = words(name).split(' ');
  if (parts.some((w) => w.length >= 4 && (printed.set.has(w) || misread(printed.set, w)))) return true;
  // A name of short words ("TEC BIO E.A.S") reads as one on the page.
  const run = parts.join('');
  return run.length >= 6 && printed.run.includes(run);
}

/** The same word with one letter misread, as Vision does: "CFBOLLA" for "CEBOLLA". */
function misread(printed: Set<string>, word: string): boolean {
  if (word.length < 5) return false;
  for (const p of printed) {
    if (p.length !== word.length) continue;
    let differing = 0;
    for (let i = 0; i < p.length && differing < 2; i++) if (p[i] !== word[i]) differing++;
    if (differing === 1) return true;
  }
  return false;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'se', 'oct', 'nov', 'dic'];

/**
 * A line that says this date is when the invoice was issued, and lines that
 * say it is anything else — due, valid from, made on, delivered on, or the
 * date of a nota de remisión, whose "remisión" the emission pattern itself
 * would otherwise match.
 */
const EMISSION = /(?:^|\P{L})(?:fecha|emisi|emitid|expedi)/iu;
const RIVAL =
  /v(?:to|cto|enc)\b|\bv\.\s*\d|vencim|vence|caduc|validez|v[áa]lid|vigencia|expir|entrega|remis|remitid|nacimiento|inicio|hasta|desde|elab|fab\b|fabricaci|lote/i;
/** The acknowledgement block at the foot: what the buyer signs and dates. */
const FOOT = /firma|aclaraci|recib[ií]|conforme/i;

/** Any date printed in the text, in the ways invoices print one. */
const ANY_DATE = /(?<!\d)(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,2})(?!\d)/g;

/**
 * Whether the text says this is the date the invoice was issued.
 *
 * Printed somewhere is not enough: an invoice also prints when it falls due,
 * when a lot was made, from when a timbrado is valid. A dollar KuDE issued on
 * 18/08/2026 falls due on 18/09/2026, and taking the second for the first
 * files the IVA in the wrong month. So the date has to sit on a line that
 * calls it the emission date, or be the only date on the paper — the rule the
 * parser reads by (see readDate).
 */
export function dateSeen(text: string, date: Date): boolean {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const year = `(?:${y}|${String(y).slice(2)})`;
  const sep = '\\s*[/.-]\\s*';
  const patterns = [
    `(?<!\\d)0?${d}${sep}0?${m}${sep}${year}(?!\\d)`,
    `(?<!\\d)${y}${sep}0?${m}${sep}0?${d}(?!\\d)`,
    `(?<!\\d)0?${d}\\s*(?:de\\s*)?${MONTHS[m - 1]}[a-z]*\\.?\\s*(?:del?\\s*)?${year}(?!\\d)`,
  ].map((p) => new RegExp(p));

  const lines = text.toLowerCase().split(/\r?\n/);
  const at: number[] = [];
  lines.forEach((line, i) => {
    if (patterns.some((p) => p.test(line))) at.push(i);
  });
  const near = (i: number) => [lines[i - 1] ?? '', lines[i] ?? '', lines[i + 1] ?? ''].join(' | ');
  // Lines that call this date something else are out from the start, and so is
  // anything standing in the block the buyer signs and dates: a credit invoice
  // has him write there the day he received the goods, in another month.
  const own = at.filter((i) => !RIVAL.test(lines[i] as string) && !FOOT.test(near(i)));
  if (!own.length) return false;

  // Printed under a label that calls it the emission date…
  if (own.some((i) => EMISSION.test(lines[i] as string))) return true;
  // …or under a bare label the rebuilt rows left on the line above or below —
  // a short line that is only a label and carries no value of its own, as a
  // KuDE's "Emisión." is, with "01/09/2026 17:48" beneath it. A paragraph that
  // merely contains the word is not one.
  const bareLabel = (s: string) => {
    const label = s.trim();
    return label.length <= 30 && EMISSION.test(label) && !/\d/.test(label);
  };
  if (
    own.some((i) => [lines[i - 1] ?? '', lines[i + 1] ?? ''].some(bareLabel) && !RIVAL.test(near(i)))
  ) {
    return true;
  }

  // …or unlabelled, as a talonario prints it ("16 DE SEPTIEMBRE DE 2026"):
  // only when nothing else could be taken for it. With no label of its own it
  // has nothing to go on, so a rival label one row away — left there by the
  // same rebuilt rows that leave "Emisión." above its date — disqualifies it,
  // and so does any other date the page does not name.
  if (!own.some((i) => !RIVAL.test(near(i)))) return false;
  const others = lines
    .filter((line) => !RIVAL.test(line))
    .flatMap((line) => [...line.matchAll(ANY_DATE)].map((m) => m[0]))
    .filter((printed) => !patterns.some((p) => p.test(printed)));
  return others.length === 0;
}

/** The digits of a document number's last group: "001-001-0000637" → "0000637". */
const lastGroup = (numeroDoc: string): string => numeroDoc.split(/\D+/).filter(Boolean).pop() ?? '';

/** The fields `missing` reports on identifiers, recounted after they changed. */
function recounted(r: ParsedReceipt): ParsedReceipt {
  const checks: [boolean, string][] = [
    [r.emisorRuc == null, 'RUC del emisor'],
    [!r.emisorNombre, 'Nombre del emisor'],
    [r.fechaEmision == null, 'Fecha'],
  ];
  const missing = r.missing.filter((label) => !checks.some(([, l]) => l === label));
  for (const [absent, label] of checks) if (absent) missing.push(label);
  return { ...r, missing };
}

/**
 * The model's reading, kept to what the OCR text of the same photo shows.
 *
 * `seen` is whether the figures stand on their own: every amount printed in
 * the text, no IVA the model worked out instead of reading, an exchange rate
 * with the guaraní total that confirms it. Identifiers, names and line items
 * the text does not show are dropped — they can be wrong without the amounts
 * being wrong. A CDC shown in the text — fromExtraction already checked that
 * it fits — vouches for the issuer, number and date it encodes.
 *
 * The user is the buyer: a reading that names the user's own RUC as the
 * issuer, with no CDC to settle it, has the two parties the wrong way round.
 */
export function witnessed(
  ai: ParsedReceipt,
  text: string,
  ownRuc: string | null = null,
  ocr: ParsedReceipt | null = null,
): { reading: ParsedReceipt; seen: boolean } {
  const cents = printedAmounts(text);
  const shown = (v: number | null) => v == null || v === 0 || cents.has(Math.round(v * 100));
  // An IVA the model worked out instead of reading is on no line of the page:
  // a gravada it asserts equal to the total would make one printed number
  // authorise the whole tax figure. The parser derives an IVA only from a
  // gravada it read against its own printed label.
  const computed = ai.derived.some((d) => d.startsWith('iva'));
  // The rate is only as good as the guaraní total that confirms it (see
  // fromExtraction), and that total has to be printed too.
  const rateShown = (): boolean => {
    const { total, tipoCambio } = ai;
    if (tipoCambio == null) return true;
    if (total == null) return false;
    const guaranies = total * tipoCambio * 100;
    return [...cents].some((c) => Math.abs(c - guaranies) <= Math.max(100, guaranies * 0.0005));
  };
  // A gravada worked out from a printed IVA is the other way round, and safe:
  // the tax figure is the one that was read.
  const gravada = (k: 'gravada5' | 'gravada10') => ai.derived.includes(k) || shown(ai[k]);
  // A reading that claims no tax at all is the one shape no arithmetic
  // constrains: exentas absorbs the whole total and still adds up, so one
  // printed number would vouch for a zero IVA on a taxed invoice. The page has
  // to say the word — the model's counterpart to the parser's exempt-only rule.
  const untaxed = (ai.iva5 ?? 0) === 0 && (ai.iva10 ?? 0) === 0 && (ai.total ?? 0) > 0;
  const exemptShown = !untaxed || /exent/.test(words(text));
  const seen =
    !computed &&
    shown(ai.total) &&
    shown(ai.exentas) &&
    gravada('gravada5') &&
    gravada('gravada10') &&
    shown(ai.iva5) &&
    shown(ai.iva10) &&
    exemptShown &&
    rateShown();

  const r: ParsedReceipt = { ...ai };
  if (r.cdc && !digitsSeen(text, r.cdc)) r.cdc = null;
  if (!r.cdc) {
    // The user is the buyer, and so is whoever the parser read in the receptor
    // block. A reading that names either of them as the issuer has the parties
    // the wrong way round — turn it back if it says who the seller is, and
    // otherwise leave the issuer unread rather than file a purchase as a sale,
    // which moves its IVA from credit to debit.
    const buyers = [ownRuc, ocr?.receptorRuc].filter(Boolean);
    if (r.emisorRuc && buyers.includes(r.emisorRuc)) {
      const seller = r.receptorRuc && !buyers.includes(r.receptorRuc) ? r.receptorRuc : null;
      [r.emisorNombre, r.receptorNombre] = [r.receptorNombre, r.emisorNombre];
      r.receptorRuc = r.emisorRuc;
      r.emisorRuc = seller;
      r.emisorDv = seller ? calcRucDv(seller) : null;
    } else if (r.emisorRuc && !ownRuc && ocr && ocr.emisorRuc == null && ocr.receptorRuc == null) {
      // Both parties' RUCs are printed on every invoice, so with nothing
      // saying which is which, the model's word alone does not decide it.
      r.emisorRuc = null;
      r.emisorDv = null;
    }
    if (r.emisorRuc && !digitsSeen(text, r.emisorRuc)) {
      r.emisorRuc = null;
      r.emisorDv = null;
    }
    if (r.numeroDoc && !digitsSeen(text, lastGroup(r.numeroDoc))) r.numeroDoc = null;
    if (r.fechaEmision && !dateSeen(text, r.fechaEmision)) r.fechaEmision = null;
  }
  if (r.timbrado && !digitsSeen(text, r.timbrado)) r.timbrado = null;
  if (r.receptorRuc && !digitsSeen(text, r.receptorRuc)) r.receptorRuc = null;
  // A name is read off the image too, and it is what the invoice is filed
  // under; line items are read off it whole. Every item has to be printed —
  // its amount, and a word of what it is — or the list is not the invoice's:
  // two invented lines that happened to add up to the total were stored.
  const printed = printedWordsOf(text);
  if (!namedIn(printed, r.emisorNombre)) r.emisorNombre = null;
  if (!namedIn(printed, r.receptorNombre)) r.receptorNombre = null;
  if (!r.items.every((it) => shown(it.total) && namedIn(printed, it.descripcion))) r.items = [];
  return { reading: recounted(r), seen };
}

// ---------------------------------------------------------------------------
// Putting the two readings together

const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ&]+/g, ' ')
    .trim();

/**
 * The issuer's name, from two readings that agree on who issued it: the
 * parser's, unless the model's is the same name without what the parser
 * picked up after it on the row. The model has put an address in the name.
 */
function issuerName(ocrName: string | null, aiName: string | null): string | null {
  if (!ocrName || !aiName) return ocrName ?? aiName;
  const short = words(aiName);
  const whole = short.includes(' ') || short.length >= 6;
  return whole && words(ocrName).startsWith(short) ? aiName : ocrName;
}

/**
 * The amounts of one reading under the identifiers both readers agree on,
 * taken first from the reading a CDC vouches for, else from the parser's, and
 * completed from the other.
 */
function identified(
  amounts: ParsedReceipt,
  ocr: ParsedReceipt | null,
  ai: ParsedReceipt | null,
): ParsedReceipt {
  const first = (ai?.cdc && !ocr?.cdc ? ai : (ocr ?? ai)) as ParsedReceipt;
  const second = first === ocr ? ai : ocr;

  const from = first.emisorRuc || !second?.emisorRuc ? first : second;
  const other = from === first ? second : first;
  const emisorRuc = from.emisorRuc;
  const sameIssuer = emisorRuc != null && other?.emisorRuc === emisorRuc;
  // What the other reading calls the RUC being filed. It has no opinion only
  // when it never placed that RUC at all: a reading that puts it on its own
  // receptor side has the parties the other way round, and the name that goes
  // with this RUC is that reading's receptorNombre — never its issuer's, which
  // is then the buyer's.
  const otherName = (): string | null => {
    if (!other || emisorRuc == null) return other?.emisorNombre ?? null;
    if (other.receptorRuc === emisorRuc) return other.receptorNombre ?? null;
    return other.emisorRuc == null ? (other.emisorNombre ?? null) : null;
  };
  const emisorNombre = sameIssuer
    ? issuerName(ocr?.emisorNombre ?? null, ai?.emisorNombre ?? null)
    : (from.emisorNombre ?? otherName());

  const buyer = [first.receptorRuc, second?.receptorRuc].find((r) => r && r !== emisorRuc) ?? null;

  return recounted({
    ...amounts,
    emisorRuc,
    emisorDv: from.emisorDv,
    emisorNombre,
    receptorRuc: buyer,
    receptorNombre: first.receptorNombre ?? second?.receptorNombre ?? null,
    timbrado: first.timbrado ?? second?.timbrado ?? null,
    numeroDoc: first.numeroDoc ?? second?.numeroDoc ?? null,
    fechaEmision: first.fechaEmision ?? second?.fechaEmision ?? null,
    cdc: first.cdc ?? second?.cdc ?? null,
    items: ai ? itemsFitting(amounts, ai.items) : [],
  });
}

/** What one reader saw that the other's amounts cannot overrule. */
function vetoed(ocr: ParsedReceipt | null, ai: ParsedReceipt | null): PhotoDecision | null {
  if (!ocr || !ai) return null;
  const nota = ocr.nota ? ocr : ai.nota ? ai : null;
  if (nota) return { kind: 'refuse', reason: 'nota', reading: nota };
  // The case that started this: a dollar invoice read as guaraníes.
  if ((ocr.foreignCurrency ?? 'PYG') !== (ai.foreignCurrency ?? 'PYG')) {
    const foreign = ocr.foreignCurrency ? ocr : ai;
    return { kind: 'refuse', reason: 'moneda', reading: { ...foreign, tipoCambio: null }, detail: 'currencies' };
  }
  // The date decides the month the IVA goes to.
  if (ocr.fechaEmision && ai.fechaEmision && +ocr.fechaEmision !== +ai.fechaEmision) {
    return { kind: 'refuse', reason: 'lecturas', reading: ocr, detail: 'dates' };
  }
  return null;
}

/**
 * @param ocr    the parser's best reading of the OCR text, if Vision read it
 * @param aiRead the model's reading (fromExtraction), if it answered
 * @param text   the OCR text of the same photo — the witness to the model
 * @param ownRuc the user's RUC, without its check digit: the buyer's
 */
export function decidePhoto(
  ocr: ParsedReceipt | null,
  aiRead: ParsedReceipt | null,
  text: string,
  ownRuc: string | null = null,
): PhotoDecision {
  const ai = aiRead ? witnessed(aiRead, text, ownRuc, ocr) : null;
  const veto = vetoed(ocr, ai?.reading ?? null);
  if (veto) return veto;

  const ocrSound = ocr != null && refusalOf(ocr) == null;
  const aiSound = ai != null && refusalOf(ai.reading) == null;

  // Both readers named amounts and they differ: one is wrong and nothing says
  // which, whether or not the model's date, RUC or name survived witnessing.
  // An identifier the text did not show says nothing about the figures.
  if (ocrSound && ai != null && amountsSound(ai.reading) && !sameAmounts(ocr, ai.reading)) {
    return { kind: 'refuse', reason: 'lecturas', reading: ocr, detail: 'amounts' };
  }
  if (ocrSound && aiSound) {
    return { kind: 'store', reading: identified(ocr, ocr, ai.reading), source: 'ocr+ai' };
  }
  if (ocrSound) {
    return { kind: 'store', reading: identified(ocr, ocr, ai?.reading ?? null), source: 'ocr' };
  }
  if (aiSound && ai.seen) {
    return { kind: 'store', reading: identified(ai.reading, ocr, ai.reading), source: 'ai' };
  }

  const basis = ocr ?? ai?.reading ?? null;
  return {
    kind: 'refuse',
    reason: (basis && refusalOf(basis)) ?? 'total',
    reading: basis,
    ...(aiSound ? { detail: 'ai-unseen' } : {}),
  };
}
