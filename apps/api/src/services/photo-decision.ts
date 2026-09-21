import { calcRucDv } from '../utils/ruc';
import { LEGAL_FORM, type Extraction, type ParsedItem, type ParsedReceipt } from './receipt-parser';

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

/**
 * Why importPhoto would refuse this reading on its own, or null.
 *
 * A foreign currency with no rate on the paper is not a reason: the law names
 * the rate then — the DNIT's close of the day before (see exchange-rates) —
 * and importPhoto looks it up. A dollar rent receipt with every figure
 * verified was refused for it four times (Residencial Domicia, 2026-09-21).
 */
export function refusalOf(p: ParsedReceipt): Refusal | null {
  if (p.nota) return 'nota';
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
    // As a whole number only when every separator groups thousands: "45.45"
    // is 45,45 and never 4.545 — read that way, a dollar receipt's IVA vouched
    // for a model that took its cents for guaraníes.
    if (!/[.,](?!\d{3}(?:[.,]|$))/.test(token)) out.add(Number(token.replace(/\D/g, '')) * 100);
    const decimal = token.match(/^(.*\d)[.,](\d{1,2})$/);
    if (decimal) {
      out.add(Math.round(Number(`${(decimal[1] as string).replace(/\D/g, '')}.${decimal[2]}`) * 100));
    }
  }
  for (const cents of amountsInWords(text)) out.add(cents);
  return out;
}

/** Spanish number words, as a talonario writes its total out. */
const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21,
  veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30,
  cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100,
  ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
  seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

/**
 * The amounts the page writes out in words, in cents: "Novecientos mil" is
 * 900.000, "quinientos con 00/100" is 500,00.
 *
 * On a talonario the figures are handwritten and the words beside them are
 * often the legible half: the "500'00" of a dollar rent receipt came back from
 * Vision as "500100", and its "quinientos con 00/100" was the one place the
 * page still said 500 (2026-09-21). Only runs worth 100 or more count — "un"
 * and "dos" are words of every sentence.
 */
export function amountsInWords(text: string): number[] {
  const tokens = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[a-z]+|\d{1,2}\s*\/\s*100/g) ?? [];
  const out: number[] = [];
  let total = 0;
  let current = 0;
  let words = 0;
  const close = (cents: number) => {
    const value = total + current;
    if (words && value >= 100) out.push(value * 100 + cents);
    total = 0;
    current = 0;
    words = 0;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    const n = NUMBER_WORDS[t];
    if (n != null) {
      current += n;
      words++;
    } else if (t === 'mil') {
      total += (current || 1) * 1000;
      current = 0;
      words++;
    } else if (/^millon(?:es)?$/.test(t)) {
      total = (total + current || 1) * 1_000_000;
      current = 0;
      words++;
    } else if (t === 'y' && words) {
      continue;
    } else if (t === 'con' && words && /^\d/.test(tokens[i + 1] ?? '')) {
      close(Number((tokens[i + 1] as string).split('/')[0]));
      i++;
    } else {
      close(0);
    }
  }
  close(0);
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

/** Written out, as a talonario's blank is filled in by hand. */
const MONTH_WORDS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Every way a month is written out, with its number. */
const MONTH_NAMES: [string, number][] = [
  ...MONTH_WORDS.map((w, i): [string, number] => [w, i + 1]),
  ['septiembre', 9],
];

/** Letters to insert, drop or swap to turn one word into the other. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] as number;
}

/**
 * The month a word is, read through Vision's misreadings of handwriting — or
 * null.
 *
 * An abbreviation ("ago", "sept", "dic") is the month it begins. A word is the
 * one month it is closest to, within reach: a letter off for a word of five
 * letters or fewer, two for a longer one. "agosto" filled in by hand came back
 * as "agasto" (2026-09-20) and as "ageste" (2026-09-21). A word as close to
 * two months is neither: "junio" and "julio" are one letter apart, and the
 * month is the period the IVA is declared in.
 */
export function monthOfWord(word: string): number | null {
  const token = word.toLowerCase();
  if (token.length < 3) return null;
  if (token.length <= 4) {
    const begun = new Set(MONTH_NAMES.filter(([name]) => name.startsWith(token)).map(([, n]) => n));
    if (begun.size === 1) return [...begun][0] as number;
  }
  if (token.length < 4) return null;
  let best = Infinity;
  let months = new Set<number>();
  for (const [name, n] of MONTH_NAMES) {
    const d = editDistance(token, name);
    if (d < best) {
      best = d;
      months = new Set([n]);
    } else if (d === best) {
      months.add(n);
    }
  }
  const reach = token.length <= 5 ? 1 : 2;
  return best <= reach && months.size === 1 ? ([...months][0] as number) : null;
}

/** Whether the window names this month — written out, and read off handwriting. */
function monthNamed(window: string, month: number): boolean {
  return (window.match(/[a-z]{3,}/g) ?? []).some((token) => monthOfWord(token) === month);
}

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
  ].map((p) => new RegExp(p));
  // Written out, the month read as handwriting is (see monthOfWord), and the
  // year as a talonario fills it in: its own "20" printed, "26" by hand.
  const inWords = new RegExp(
    `(?<!\\d)0?${d}\\s*(?:de\\s*\\.?\\s*)?([a-z]+)\\.?\\s*(?:del?\\s*)?` +
      `(?:${y}|${String(y).slice(0, 2)}\\s*[.\\s]\\s*${String(y).slice(2)}|${String(y).slice(2)})(?!\\d)`,
    'g',
  );
  const shows = (line: string) =>
    patterns.some((p) => p.test(line)) ||
    [...line.matchAll(inWords)].some((x) => monthOfWord(x[1] as string) === m);

  const lines = text.toLowerCase().split(/\r?\n/);
  const at: number[] = [];
  lines.forEach((line, i) => {
    if (shows(line)) at.push(i);
  });
  const near = (i: number) => [lines[i - 1] ?? '', lines[i] ?? '', lines[i + 1] ?? ''].join(' | ');
  // Lines that call this date something else are out from the start, and so is
  // anything standing in the block the buyer signs and dates: a credit invoice
  // has him write there the day he received the goods, in another month.
  // Handwritten on a talonario's blanks, which Vision scatters: "Fecha de
  // Emisión: 19 de." then "Agosto" on the next line, and the year's "26",
  // written after the printed "20", rows further down as "de 20.26". The day
  // and month have to sit right under the emission label — that is what ties
  // them to the emission and not to a due date — and the year may be anywhere,
  // whole or split. (Cevelio, 2026-09-20: read right by the model, lost here.)
  const labelled = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => EMISSION.test(line) && !RIVAL.test(line) && !FOOT.test(line));
  if (labelled.some(({ i }) => handwrittenNear(lines, i, d, m, y).full)) return true;

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

/**
 * A date filled into a talonario's blanks, read around the emission label at
 * [i]: the day beside the label, the month written out near it, the year
 * anywhere on the page (the printed "20" and a handwritten "26" come back as
 * "20.26").
 *
 * `full` means all three were read. `dayYear` means the day and the year were,
 * and only the month word was lost — the reading is kept then, and flagged for
 * the user to check, because refusing an invoice whose every figure has been
 * verified over one handwritten word helps nobody.
 */
function handwrittenNear(
  lines: string[],
  i: number,
  d: number,
  m: number,
  y: number,
): { full: boolean; dayYear: boolean } {
  const window = lines
    .slice(i, i + 3)
    .filter((line, k) => k === 0 || !RIVAL.test(line))
    .join(' ');
  const day = new RegExp(`(?<!\\d)0?${d}\\s*(?:de\\s*)?\\.?(?![\\d/.-]?\\d)`).test(window);
  const year = new RegExp(
    `(?<!\\d)(?:${y}|${String(y).slice(0, 2)}\\s*[.\\s]\\s*${String(y).slice(2)})(?!\\d)`,
  ).test(lines.join('\n'));
  if (!day || !year) return { full: false, dayYear: false };
  return { full: monthNamed(window, m), dayYear: true };
}

/**
 * Whether the page shows the day and the year of this date beside its emission
 * label, but not the month in words.
 *
 * On a handwritten talonario Vision gets a letter of the month wrong often
 * enough that refusing over it costs the client invoices whose every figure
 * has been verified. The reading is kept and flagged instead, so the app can
 * ask him to check the date rather than turn the photo away.
 */
export function datePartlySeen(text: string, date: Date): boolean {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const lines = text.toLowerCase().split(/\r?\n/);
  return lines.some((line, i) => {
    if (!EMISSION.test(line) || RIVAL.test(line) || FOOT.test(line)) return false;
    const seen = handwrittenNear(lines, i, d, m, y);
    if (!seen.dayYear || seen.full) return false;
    // Lost, not contradicted: a page that reads "Agosto" beside the label
    // does not half confirm a July the model wrote.
    const window = lines.slice(i, i + 3).join(' ');
    return !(window.match(/[a-z]{3,}/g) ?? []).some((token) => monthOfWord(token) != null);
  });
}

/** The label the app shows when a date was read but not fully confirmed. */
export const DATE_UNCONFIRMED = 'Fecha (confirmá el mes)';

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
  rows: string[] = [],
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
  let unconfirmedDate = false;
  // A rate no printed guaraní total confirms is not the invoice's: kept, it
  // went on record beside the parser's figures as the document's own — which
  // no one can then correct (see setTipoCambio).
  if (!rateShown()) r.tipoCambio = null;
  if (r.cdc && !digitsSeen(text, r.cdc)) r.cdc = null;
  if (!r.cdc) {
    // The user is the buyer, and so is whoever the parser read in the receptor
    // block. A reading that names either of them as the issuer has the parties
    // the wrong way round — turn it back if it says who the seller is, and
    // otherwise leave the issuer unread rather than file a purchase as a sale,
    // which moves its IVA from credit to debit.
    // The user's own RUC, when known, is the buyer and nothing else is: the
    // parser's receptor is a guess, and on a page it could not read it took
    // the seller's RUC for the buyer's and undid a correct issuer (Cevelio,
    // 2026-09-20). It only stands in when the profile has no RUC.
    const buyers = (ownRuc ? [ownRuc] : [ocr?.receptorRuc]).filter(Boolean);
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
    // The date is read line by line, and a talonario's filled-in blanks come
    // apart in Vision's blocks: "Santa Rita, 31 de" on one line, the month on
    // the next, "de 2026" seven lines down. The printed rows rebuilt from the
    // same words keep them on one line (Residencial Domicia, 2026-09-21).
    const texts = [text, ...rows.filter((t) => t && t !== text)];
    const fecha = r.fechaEmision;
    if (fecha && !texts.some((t) => dateSeen(t, fecha))) {
      // Day and year beside the emission label, month lost to handwriting:
      // keep it and say so, rather than refuse an invoice whose amounts the
      // page confirmed (Cevelio, 2026-09-20).
      if (texts.some((t) => datePartlySeen(t, fecha))) unconfirmedDate = true;
      else r.fechaEmision = null;
    }
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
  const reading = recounted(r);
  if (unconfirmedDate && !reading.missing.includes(DATE_UNCONFIRMED)) {
    reading.missing = [...reading.missing, DATE_UNCONFIRMED];
  }
  return { reading, seen };
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

/** A line that names the buyer, not the seller. */
const BUYER_LINE = /client|se[ñn]or|raz[oó]n\s*social|nombre/i;

/** Where the seller is, which the model has given for who it is. */
const ADDRESS = /\b(?:ruta|calle|avda|avenida|km|casi|esquina|barrio|paraguay)\b/i;

/**
 * The issuer's name, from two readings that agree on who issued it.
 *
 * The model's when it is the parser's without what the parser picked up
 * after it on the row. The parser's when the model gave an address for the
 * name, and when the parser's is the registered name — it carries its legal
 * form, S.A., S.R.L., E.A.S. — and not the buyer's. Otherwise the model's,
 * read off the letterhead: the parser took a talonario's printed economic
 * activities for the name ("ACTIVIDADES DE SERVICIOS PERSONALES N.C.P",
 * "CONSTRUCCIÓN DE EDIFICIOS"), and a label ("Serie: AA") (2026-09-21).
 *
 * The model's name reaches here only when a word of it is printed (see
 * witnessed).
 */
function issuerName(
  ocrName: string | null,
  aiName: string | null,
  buyerNames: (string | null)[],
): string | null {
  if (!ocrName || !aiName) return ocrName ?? aiName;
  const short = words(aiName);
  const whole = short.includes(' ') || short.length >= 6;
  if (whole && words(ocrName).startsWith(short)) return aiName;
  // Nor the buyer's name, which the model has given as the seller's with the
  // RUCs right ("Tec Bio Solution" for Cevelio).
  const buyers = buyerNames.map((b) => (b ? words(b) : '')).filter((b) => b.length >= 4);
  const isBuyer = (name: string) => buyers.some((b) => words(name).includes(b) || b.includes(words(name)));
  if (ADDRESS.test(aiName) || isBuyer(aiName)) return ocrName;
  return LEGAL_FORM.test(ocrName) && !BUYER_LINE.test(ocrName) && !isBuyer(ocrName) ? ocrName : aiName;
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
    ? issuerName(ocr?.emisorNombre ?? null, ai?.emisorNombre ?? null, [
        ai?.receptorNombre ?? null,
        ocr?.receptorNombre ?? null,
      ])
    : (from.emisorNombre ?? otherName());

  const buyer = [first.receptorRuc, second?.receptorRuc].find((r) => r && r !== emisorRuc) ?? null;
  // The rate the model read and the printed guaraní total confirmed (see
  // fromExtraction), under amounts in the same currency: the parser never
  // reads one, and storing its figures dropped it.
  const tipoCambio =
    amounts.tipoCambio ??
    (ai && ai.foreignCurrency === amounts.foreignCurrency ? ai.tipoCambio : null);

  return recounted({
    ...amounts,
    tipoCambio,
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

/** A rate label: "Cotización", "Tipo de cambio", "Tipo Cambio", "T. Cambio", "T.C.". */
const RATE_LABEL = /cotiz\w*|tipo\s*(?:de\s*)?cambio|\bt\.\s*c(?:ambio|\.)/i;

/**
 * Whether the page prints its own exchange rate: a rate label with a figure
 * beside it, or alone on its line with the figure on the next — Vision's
 * blocks put "Cotizacion:" and "6.027,92Gs." on two lines as often as one.
 * Not the clause about paying "al tipo de cambio del día".
 */
function ratePrinted(texts: string[]): boolean {
  return texts.some((text) => {
    const lines = text.split(/\r?\n/);
    return lines.some((line, i) => {
      const at = line.match(RATE_LABEL);
      if (!at) return false;
      const rest = line.slice((at.index ?? 0) + at[0].length);
      if (/del\s*d[ií]a/i.test(rest)) return false;
      if (/\d[\d.,]{2,}/.test(rest)) return true;
      return /^[\s:.]*(?:gs\.?)?\s*$/i.test(rest) && /^\s*(?:gs\.?\s*)?\d[\d.,]{2,}/i.test(lines[i + 1] ?? '');
    });
  });
}

/**
 * A reading to store — unless it is in another currency and the page prints
 * its own rate, which no reader confirmed. The law takes the rate the invoice
 * carries before any other, and its XML has it; the DNIT's close is for the
 * invoice that prints none (see exchange-rates).
 */
function stored(reading: ParsedReceipt, source: PhotoSource, texts: string[]): PhotoDecision {
  if (reading.foreignCurrency && reading.tipoCambio == null && ratePrinted(texts)) {
    return { kind: 'refuse', reason: 'moneda', reading, detail: 'rate' };
  }
  return { kind: 'store', reading, source };
}

/**
 * Whether one of these figures has cents and is printed with them — which a
 * guaraní never is. Printed, and matching: the model can write an IVA of
 * 81.818,18 it worked out from a Gs 900.000 total, and "con 00/100" is how
 * some write a guaraní total out too. The 45,45 on a dollar rent receipt is
 * on the paper.
 */
function centsPrinted(values: (number | null)[], text: string): boolean {
  const cents = printedAmounts(text);
  return values.some(
    (v) => v != null && Math.abs(v - Math.round(v)) > 1e-9 && cents.has(Math.round(v * 100)),
  );
}

/**
 * The model's extraction in the currency the page is in.
 *
 * A talonario that prints the choice — "Son: ☐ Guaraníes ☐ Dólares
 * Americanos" — leaves the text unable to say which box is ticked. The model
 * sees the tick, but not reliably: one dollar rent receipt came back in
 * dollars in production and in guaraníes on the same photo here, with an IVA
 * of 45,45 (Residencial Domicia, 2026-09-21). Guaraníes have no cents, so a
 * reading in guaraníes whose printed figures carry them, on a page that offers
 * or names another currency, is in that currency.
 */
export function settledCurrency(x: Extraction, ocr: ParsedReceipt | null, text: string): Extraction {
  const other = ocr?.foreignCurrency ?? ocr?.currencyChoice ?? null;
  if (x.moneda !== 'PYG' || !other) return x;
  if (!centsPrinted([x.total, x.gravada5, x.gravada10, x.exentas, x.iva5, x.iva10, x.totalIva], text)) {
    return x;
  }
  const moneda = (['USD', 'BRL', 'EUR'] as const).find((c) => c === other) ?? 'OTRA';
  return { ...x, moneda };
}

/**
 * Whether the page shows a reading's figures are not guaraníes: cents printed
 * in them, or an exchange rate the printed guaraní total confirms (see
 * witnessed).
 *
 * Where the form only offers the currency, the model's word is all that says
 * "dollars", and a Gs 900.000 invoice read as USD 900.000 would go into the
 * IVA some six thousand times over.
 */
function foreignShown(r: ParsedReceipt, text: string): boolean {
  return r.tipoCambio != null || centsPrinted([r.total, r.gravada5, r.gravada10, r.exentas, r.iva5, r.iva10], text);
}

/**
 * The least a guaraní invoice on a form that also offers dollars is taken to
 * be. Below it the figures say nothing: USD 1.100 with an IVA of 100 — a rent
 * of "1.000 más IVA" — reads the same in guaraníes, and only the tick tells
 * them apart.
 */
const LEAST_GUARANIES_ON_A_CHOICE = 20_000;

/**
 * The parser's reading in the currency the model saw ticked, where the form
 * only offers it — or 'open' when nothing settles it.
 *
 * Either answer needs more than the model's word, and its own figures have to
 * hold in the currency it gave. Dollars need the page to show something a
 * guaraní amount cannot have; the parser's figures are read the guaraní way
 * and must never go on record as dollars on the model's say-so. Guaraníes need
 * a total a dollar invoice of the same figures is not — the model missed the
 * tick on a dollar receipt once already. And the currency has to be one the
 * form offers. With no model there is nothing to say which box is ticked.
 */
function choiceSettled(
  ocr: ParsedReceipt | null,
  model: ParsedReceipt | null,
  text: string,
): ParsedReceipt | null | 'open' {
  if (!ocr || ocr.foreignCurrency != null || !ocr.currencyChoice) return ocr;
  if (!model || !amountsSound(model)) return 'open';
  const chosen = model.foreignCurrency;
  if (chosen != null && (chosen !== ocr.currencyChoice || !foreignShown(model, text))) return 'open';
  if (chosen == null && (model.total ?? 0) < LEAST_GUARANIES_ON_A_CHOICE) return 'open';
  return { ...ocr, foreignCurrency: chosen, currencyChoice: null };
}

/**
 * The parser's reading without an issuer that is the user. The user is the
 * buyer of what he photographs (see witnessed), and the parser, skipping an
 * issuer's RUC it misread, could take the next one in the header — the
 * customer block's — and file a purchase as a sale, its IVA moved from credit
 * to debit. A CDC would settle it; a paper invoice has none.
 */
function buyerAsIssuerDropped(ocr: ParsedReceipt | null, ownRuc: string | null): ParsedReceipt | null {
  if (!ocr || !ownRuc || ocr.cdc || ocr.emisorRuc !== ownRuc) return ocr;
  return recounted({ ...ocr, emisorRuc: null, emisorDv: null, emisorNombre: null });
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
 * @param ocrRead the parser's best reading of the OCR text, if Vision read it
 * @param aiRead  the model's reading (fromExtraction), if it answered
 * @param text    the OCR text of the same photo — the witness to the model
 * @param ownRuc  the user's RUC, without its check digit: the buyer's
 * @param rows    the same words rebuilt into printed rows (see ocr's layouts)
 */
export function decidePhoto(
  ocrRead: ParsedReceipt | null,
  aiRead: ParsedReceipt | null,
  text: string,
  ownRuc: string | null = null,
  rows: string[] = [],
): PhotoDecision {
  const parsed = buyerAsIssuerDropped(ocrRead, ownRuc);
  const ai = aiRead ? witnessed(aiRead, text, ownRuc, parsed, rows) : null;
  const settled = choiceSettled(parsed, ai?.reading ?? null, text);
  if (settled === 'open') {
    return { kind: 'refuse', reason: 'moneda', reading: ai?.reading ?? parsed, detail: 'choice' };
  }
  const ocr = settled;
  const texts = [text, ...rows.filter((t) => t && t !== text)];

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
    return stored(identified(ocr, ocr, ai.reading), 'ocr+ai', texts);
  }
  if (ocrSound) {
    return stored(identified(ocr, ocr, ai?.reading ?? null), 'ocr', texts);
  }
  if (aiSound && ai.seen) {
    return stored(identified(ai.reading, ocr, ai.reading), 'ai', texts);
  }

  const basis = ocr ?? ai?.reading ?? null;
  // Why the model's reading did not carry the photo. Without this the log said
  // only "no total found", which is the parser's story, and the model's side
  // of a refusal could not be told apart from the model never answering —
  // the client retried a handwritten talonario twice and we could not say
  // which rule turned it down (2026-09-20).
  const aiRefusal = ai ? refusalOf(ai.reading) : null;
  const aiState =
    ai == null ? 'none' : aiSound ? (ai.seen ? 'sound' : 'unseen') : (aiRefusal ?? 'none');
  // Which reading gets to explain itself. When the model's figures hold and
  // only one field stopped it, that field is what went wrong — telling the
  // user "no pudimos leer el total" about an invoice whose total we read, and
  // whose date we could not confirm, sends him to photograph the wrong half
  // of the page (Cevelio, 2026-09-20).
  const reason =
    ai != null && aiRefusal != null && amountsSound(ai.reading) && ocr?.total == null
      ? aiRefusal
      : ((basis && refusalOf(basis)) ?? 'total');
  return {
    kind: 'refuse',
    reason,
    reading: basis,
    detail: `ai:${aiState}`,
  };
}
