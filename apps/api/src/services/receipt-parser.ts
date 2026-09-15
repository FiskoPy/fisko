/**
 * Extracts the fiscal fields from the OCR text of a Paraguayan paper invoice
 * or till receipt.
 *
 * Nothing here is guaranteed: every field is optional and the caller decides
 * what to do with what is missing. The parser never guesses a number it did
 * not read — a wrong total on a tax record is worse than an empty one the user
 * is asked to complete.
 *
 * THE RULE THIS FILE IS BUILT AROUND: in Paraguay the printed price already
 * includes IVA. So for the amount printed as "TOTAL GRAVADAS 10%" (gross),
 *     IVA 10% = gravada / 11        IVA 5% = gravada / 21
 * and the net taxable base (what SIFEN calls dBaseGrav, and what this app
 * stores) is gravada − IVA. Verified against two real tickets:
 * 545.600/11 = 49.600 and 42.000/21 = 2.000, both matching the printed IVA.
 *
 * That identity is not decoration — it is how the parser tells a base apart
 * from a tax when the ticket labels both the same way. A real supermarket
 * footer does exactly that:
 *     TOTAL GRAVADAS 10% GS:  146.589     <- base
 *     LIQUIDACION IVA
 *     TOTAL GRAVADAS 10% GS:   13.326     <- tax, same label
 */

import { isValidCdcCheckDigit } from './sifen';

export interface ParsedReceipt {
  emisorRuc: string | null;
  emisorDv: number | null;
  emisorNombre: string | null;
  receptorRuc: string | null;
  receptorNombre: string | null;
  timbrado: string | null;
  /** e.g. "001-001 0000071" */
  numeroDoc: string | null;
  fechaEmision: Date | null;
  total: number | null;
  /** Gross amounts as printed ("TOTAL GRAVADAS N%"), IVA included. */
  gravada5: number | null;
  gravada10: number | null;
  exentas: number | null;
  iva5: number | null;
  iva10: number | null;
  /** The "TOTAL IVA" line, when printed — used only to cross-check. */
  totalIva: number | null;
  /**
   * The CDC printed on a KuDE — the paper copy of an electronic invoice — when
   * it is certainly this document's (see readCdc). It names the same invoice
   * its XML does.
   */
  cdc: string | null;
  /**
   * Set for a credit or debit note. The photo path stores invoices, which add;
   * a note stored as one would add where it subtracts.
   */
  nota: 'credito' | 'debito' | null;
  /**
   * Whether the amounts agree with each other: TOTAL with gravadas + exentas,
   * give or take the rounding, and each IVA with its own gravada. null when
   * there was nothing to compare.
   */
  totalsAgree: boolean | null;
  /** Fiscal amounts computed from the other side of their rate, not read. */
  derived: ('gravada5' | 'gravada10' | 'iva5' | 'iva10')[];
  /** Fields the OCR could not read; the app asks the user to fill these in. */
  missing: string[];
  /** Rough 0..1 signal of how much of the document we understood. */
  confidence: number;
}

const MONTHS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
};

/** IVA is embedded in the price, so the divisor is 1 + 1/rate. */
const DIVISOR: Record<5 | 10, number> = { 5: 21, 10: 11 };

/**
 * Paraguayan amounts use "." for thousands and "," for decimals.
 *
 * Zero is a legitimate reading — "TOTAL EXENTAS GS: 0" means there were no
 * exempt goods, which is information. Callers that need a positive number
 * (the total) check for themselves.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const norm = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Whether a and b are at most one insertion, deletion or substitution apart. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * "TOTAL" as OCR misspells it, put back.
 *
 * A KuDE photographed on 2026-09-15 printed "Total:" and Vision read "Tolal:",
 * so its total went unread; a left edge cut off by the photo gives "OTAL".
 * Only whole words one edit away are restored, and only this word: the fiscal
 * labels are matched by stems ("gravad", "liquidac") that already survive
 * such damage, and "IVA" is too short to correct safely — "VIA" is a word.
 */
function fixLabelTypos(line: string): string {
  return line.replace(/(?<!\p{L})\p{L}{4,6}(?!\p{L})/gu, (w) => {
    const low = w.toLowerCase();
    if (low === 'total' || !oneEditApart(low, 'total')) return w;
    // "BTOTAL" is SUBTOTAL with its left edge cut off, not a misread TOTAL.
    if (low.length === 6 && low.endsWith('total')) return w;
    return w === w.toUpperCase() ? 'TOTAL' : 'Total';
  });
}

/**
 * The last number on a line, which must begin with a digit.
 *
 * Requiring a leading digit is what stops a dot leader being read as the
 * value: "TOTAL IVA...........: Gs 51.600" would otherwise capture the dots.
 */
function lastNumber(line: string): number | null {
  const m = line.match(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?!.*\d)/);
  return m ? parseAmount(m[1] as string) : null;
}

/**
 * A line that is nothing but an amount, optionally with a currency token.
 *
 * Cloud Vision reads a receipt by blocks, and on a two-column footer it often
 * emits the label on one line and its value on the next:
 *     TOTAL A PAGAR
 *     Gs 587.600
 * The first parser rewrite assumed both sat on one line — the fixtures were
 * reconstructed by hand that way — and real photos were rejected for "no
 * total". Only a line with no other words qualifies, so the NEXT label's number
 * is never borrowed.
 */
function amountOnly(line: string | undefined): number | null {
  if (!line) return null;
  const m = line.match(
    /^\s*(?:g\s*s\.?|g\$|₲)?\s*[:.]?\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s*$/i,
  );
  return m ? parseAmount(m[1] as string) : null;
}

/** RUC as printed: 5-8 digits plus a check digit. */
function findRuc(text: string): { ruc: string; dv: number } | null {
  const m = text.match(/(?<![\d-])(\d{5,8})\s*[-–]\s*(\d)(?![\d-])/);
  if (!m) return null;
  return { ruc: m[1] as string, dv: Number(m[2]) };
}

// ---------------------------------------------------------------------------
// Fiscal footer

interface Labelled {
  rate: 5 | 10;
  value: number;
  index: number;
  liquidacion: boolean;
}

/** A line is fiscal when it names one of these; item lines never do. */
const FISCAL_LABEL = /gravad|liquidac|\biva\b|impuesto/;

/**
 * Every amount printed on a fiscal line against a rate.
 *
 * The gate is the LINE, not the distance between a label word and the rate.
 * Pre-printed forms detach the two — "LIQUIDACIÓN DEL IVA: (5%) (10%) 81.818"
 * puts both rates in brackets after the label — while a till receipt ends
 * every item with its rate ("...  69.990  8.119  10"). Gating on the line
 * accepts the first and rejects the second, which keying on proximity or on
 * the bare rate cannot do.
 *
 * The rate must still be followed by the amount: in "(5%) (10%) 81.818" only
 * the 10% column has a figure, and 5% must not steal it.
 */
function collectLabelled(lines: string[]): Labelled[] {
  const out: Labelled[] = [];
  // A KuDE footnotes a rate with an asterisk ("IVA 5%* Gs 0"): step over it.
  const re = /(?<!\d)0?(10|5)\s*%\s*\*?\s*\)?[\s:.]*(?:g\s*s\.?|g\$|₲)?[\s:.]*(\d[\d.,]*)/gi;

  lines.forEach((line, index) => {
    const low = norm(line);
    if (!FISCAL_LABEL.test(low)) return;
    // "LIQUIDACIÓN" anywhere on the line marks its amounts as tax; a line that
    // only says "GRAVADAS" is stating the base.
    const liquidacion = /liquidac|\biva\b|impuesto/.test(low) && !/gravad/.test(low)
      ? true
      : /liquidac/.test(low);

    let found = false;
    for (const m of line.matchAll(re)) {
      const value = parseAmount(m[2] as string);
      if (value == null) continue;
      out.push({ rate: Number(m[1]) as 5 | 10, value, index, liquidacion });
      found = true;
    }

    // Label and rate on this line, amount on the next (see amountOnly).
    if (!found) {
      const rate = line.match(/(?<!\d)0?(10|5)\s*%/);
      const value = rate ? amountOnly(lines[index + 1]) : null;
      if (rate && value != null) {
        out.push({ rate: Number(rate[1]) as 5 | 10, value, index, liquidacion });
      }
    }
  });
  return out;
}

/**
 * Decides which of two amounts under the same rate is the base and which is
 * the tax, by arithmetic rather than by position.
 *
 * Because the two arrangements differ by a factor of d², picking the smaller
 * relative error is never a close call; the threshold only rejects noise.
 */
function arbitrate(
  values: number[],
  d: number,
): { base: number; iva: number } | null {
  if (values.length < 2) return null;
  const [a, b] = [values[0] as number, values[1] as number];
  if (a === 0 && b === 0) return { base: 0, iva: 0 };

  const err = (base: number, iva: number): number =>
    iva <= 0 || base < d - 1 ? Infinity : Math.abs(base / d - iva) / Math.max(iva, 1);

  const eA = err(a, b);
  const eB = err(b, a);
  if (!Number.isFinite(eA) && !Number.isFinite(eB)) return null;

  const best = eA <= eB ? { base: a, iva: b, e: eA } : { base: b, iva: a, e: eB };
  // 2% covers the rounding a till does on each line; beyond that the two
  // numbers are not a base/tax pair and we would be inventing a relationship.
  return best.e <= 0.02 ? { base: best.base, iva: best.iva } : null;
}

interface Fiscal {
  gravada5: number | null;
  gravada10: number | null;
  iva5: number | null;
  iva10: number | null;
  /** A tax amount was set aside for exceeding a tenth of the total. */
  rejected?: boolean;
  /** Fields computed from the other side of their rate rather than read. */
  derived?: ('gravada5' | 'gravada10' | 'iva5' | 'iva10')[];
}

function readFiscal(lines: string[], total: number | null): Fiscal {
  const found = collectLabelled(lines);
  const liq = lines.findIndex((l) => /liquidac/.test(norm(l)));
  const out: Fiscal = { gravada5: null, gravada10: null, iva5: null, iva10: null };

  for (const rate of [5, 10] as const) {
    const mine = found.filter((f) => f.rate === rate);
    if (!mine.length) continue;
    const d = DIVISOR[rate];

    // First try arithmetic: it is the only evidence that cannot be fooled by
    // a printer that lays the footer out differently.
    const decided = arbitrate(mine.map((f) => f.value), d);
    if (decided) {
      out[`gravada${rate}`] = decided.base;
      out[`iva${rate}`] = decided.iva;
      continue;
    }

    // Only one amount for this rate, or two that do not relate. Fall back to
    // position: past the "LIQUIDACIÓN" heading, or under an explicit IVA
    // label, an amount is the tax; otherwise it is the base.
    for (const f of mine) {
      const isTax = f.liquidacion || (liq >= 0 && f.index >= liq);
      // A "tax" bigger than a tenth of the total is not a tax. Without this a
      // mislabelled base would be stored as IVA and inflate the credit.
      if (isTax && !(total != null && f.value > total / 10)) {
        out[`iva${rate}`] ??= f.value;
      } else if (isTax) {
        // Either this tax or the total is misread, and nothing here says
        // which: a contradiction, not a value to drop quietly.
        out.rejected = true;
      } else {
        out[`gravada${rate}`] ??= f.value;
      }
    }

    // One side read, the other derivable by the rule the invoice itself obeys.
    const g = out[`gravada${rate}`];
    const i = out[`iva${rate}`];
    if (g != null && i == null) {
      out[`iva${rate}`] = Math.round(g / d);
      (out.derived ??= []).push(`iva${rate}`);
    } else if (g == null && i != null) {
      out[`gravada${rate}`] = Math.round(i * d);
      (out.derived ??= []).push(`gravada${rate}`);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Total

/**
 * Labels that carry a total but not THE total. "TOTAL PAGADO" is the cash
 * handed over, which can exceed the price. And a line with a percentage on it
 * is a gravada or IVA line whatever else it lost: "TOTAL GRAVADAS 10%" missing
 * its middle word read "TOTAL 10%: 47.500", and the 10% amount became the
 * total. Only "…% incluido" — the IVA a total says it includes — is let by.
 */
const NOT_TOTAL =
  /sub\s*-?\s*total|total\s+exent|total\s+gravad|total\s+iva(?!\s*incl)|liquidac|total\s+descuent|acumulad|puntos|saldo|ahorro|anterior|redondeo|res\.?\s*\d+|pagad|%(?!\s*incl)/;

/**
 * Ranked: the more specific the label, the more we trust it.
 *
 * "a pagar" is matched without requiring "total" in front of it. People
 * photograph receipts at an angle and the left edge gets cut, so Vision
 * reports "AL A PAGAR.......: Gs 587.600" — the amount is unambiguous even
 * when the word before it is not.
 */
const TOTAL_LABELS: [RegExp, number][] = [
  [/\ba\s*pagar\b/, 100],
  [/importe\s*total/, 90],
  [/total\s*(?:g\s*s|g\$|₲)\b/, 80],
  // A KuDE prints its total as "Total Pago.": below the labels that name the
  // total outright, above a bare "TOTAL".
  [/\btotal\s*pago\b/, 70],
  // "TOTAL IVA INCLUIDO" names the total, not the tax; ranked under a bare
  // TOTAL in case a till prints its tax under that label.
  [/\btotal\s+iva\s*incl/, 30],
  [/\btotal\b/, 40],
];

interface TotalCandidate {
  rank: number;
  value: number;
  index: number;
  /** Read from the next line rather than beside the label. */
  borrowed: boolean;
}

/**
 * Every labelled total on the ticket, best first: the highest rank and, on a
 * tie, the lowest on the paper — the payable total is printed below the
 * breakdown.
 *
 * Deliberately no "largest number in the document" fallback. On a till
 * receipt the largest number is a unit price or an order number, and a
 * plausible-looking wrong total is worse than none: the app can ask.
 */
function totalCandidates(lines: string[]): TotalCandidate[] {
  const out: TotalCandidate[] = [];
  lines.forEach((line, index) => {
    const low = norm(line);
    if (NOT_TOTAL.test(low)) return;
    const hit = TOTAL_LABELS.find(([re]) => re.test(low));
    if (!hit) return;
    // A bare "TOTAL" right above the Ley 347 rounding is the subtotal before
    // rounding, whose "SUB" the photo lost.
    if (hit[1] === 40 && /redondeo|res\.?\s*\d+|sedeco/.test(norm(lines[index + 1] ?? ''))) return;
    // The amount after the label on its own line — never a quantity before
    // it; failing that, a next line holding only an amount.
    const at = low.match(hit[0]) as RegExpMatchArray;
    const beside = lastNumber(low.slice((at.index ?? 0) + at[0].length));
    const value = beside ?? amountOnly(lines[index + 1]);
    if (value == null || value <= 0) return;
    out.push({ rank: hit[1], value, index, borrowed: beside == null });
  });
  return out.sort((a, b) => b.rank - a.rank || b.index - a.index);
}

/** What the app shows when the total and the IVA detail contradict each other. */
export const TOTALS_DISAGREE = 'Total o IVA (los montos no cuadran)';

/**
 * The Ley 347 rounding a ticket prints ("REDONDEO LEY 347-14: 0",
 * "RES.347-SEDECO: 29"): the one gap allowed between a total and its parts.
 * Read after the label, whose own "347" is not the amount; a figure above 100
 * is not a rounding.
 */
function readRounding(lines: string[]): number | null {
  for (const line of lines) {
    const low = norm(line);
    if (!/redondeo|sedeco|res\.?\s*347|ley\s*347/.test(low)) continue;
    const value = lastNumber(low.replace(/res\.?\s*347\S*|ley\s*347\S*|redondeo|sedeco/g, ''));
    if (value != null && value <= 100) return value;
  }
  return null;
}

/**
 * The footer's own arithmetic: TOTAL = gravadas 5% + gravadas 10% + exentas.
 *
 * Checked because a plausible wrong total is the worst thing this parser can
 * store, and it happened: "TOTAL GS:" paired with the Ley 347 rounding printed
 * beside the line above stored a Gs 223.150 ticket as Gs 29 (2026-09-15).
 *
 * Exact, but for the gaps that really occur: the Ley 347 rounding when the
 * ticket prints it (that ticket's gravadas add up to 223.179, less 29), and
 * half a divisor for a gravada computed from its IVA. A tolerance of a
 * hundred guaraníes let a misread digit through as agreeing.
 */
function totalsAgree(
  total: number | null,
  f: Fiscal,
  exentas: number | null,
  rounding: number | null,
): boolean | null {
  if (total == null) return null;
  if (f.rejected) return false;
  const parts = [f.gravada5, f.gravada10, exentas];
  if (parts.every((v) => v == null)) return null;
  const sum = parts.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  // A positive total over nothing taxed and nothing exempt is a misreading,
  // however small: under a tolerance alone, "total Gs 1" passed.
  if (sum <= 0) return false;
  // Guaraníes are whole: printed parts add up to the total exactly. Only a
  // gravada computed from its IVA carries that IVA's rounding.
  const slack = (f.derived?.includes('gravada5') ? 11 : 0) + (f.derived?.includes('gravada10') ? 6 : 0);
  const expected = rounding ? [sum - rounding, sum + rounding] : [sum];
  if (expected.some((e) => Math.abs(total - e) <= slack)) return true;
  // The same rounding with its line unread: Ley 347 rounds in the consumer's
  // favour, down to a multiple of 50 — so a total on a multiple of 50, less
  // than 50 under its parts. A misread digit rarely lands in that window.
  const gap = sum - total;
  return rounding == null && total % 50 === 0 && gap >= -slack && gap < 50 + slack;
}

/**
 * Both rates against the printed "TOTAL IVA". It sees what the other checks
 * cannot: a rate gone missing while the rest still adds up. In testing, a
 * Primavera ticket whose 5% lines were lost read 13.326 of IVA against a
 * printed 16.973, with its total and its 10% rate both consistent.
 */
function ivaSumAgrees(f: Fiscal, totalIva: number | null): boolean {
  if (totalIva == null || (f.iva5 == null && f.iva10 == null)) return true;
  // An IVA computed from its gravada rounds once, on the total; a till that
  // rounds per line can print a sum a guaraní or two away from it.
  const slack = 2 + 2 * (f.derived?.filter((d) => d.startsWith('iva')).length ?? 0);
  return Math.abs((f.iva5 ?? 0) + (f.iva10 ?? 0) - totalIva) <= slack;
}

/**
 * Each IVA against its own gravada: IVA 10% = gravada / 11, IVA 5% = gravada
 * / 21, rounded, give or take the one guaraní a till that rounds per line can
 * add. A band in percent let a misread digit of the IVA through.
 *
 * The total can agree while a rate is wrong. A photo taken off-axis moved a
 * KuDE's IVA 10% amount onto the IVA 5% line, and 4.364 of IVA landed on a 5%
 * base of 0 with the total intact. A value derived from the other side agrees
 * by construction; only two amounts the photo put side by side can fail.
 */
function ratesAgree(f: Fiscal): boolean {
  for (const rate of [5, 10] as const) {
    const g = f[`gravada${rate}`];
    const i = f[`iva${rate}`];
    if (g == null || i == null) continue;
    if (Math.abs(Math.round(g / DIVISOR[rate]) - i) > 1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Date

/** Labels whose date is not the date of the sale. */
const NOT_DATE =
  /vigencia|vencimiento|valido|vence|timbrado|pedido|nro|numero|n°|cdc|autorizac|orden|caducidad|inicio/;

function plausible(d: Date): boolean {
  if (Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  if (year < 2015 || year > new Date().getUTCFullYear() + 1) return false;
  // Not meaningfully in the future: an invoice is issued when it is issued.
  return d.getTime() <= Date.now() + 2 * 86_400_000;
}

function readDate(lines: string[]): Date | null {
  // Same separator on both sides, and no digit or separator touching either
  // end — that is what keeps "16-11-1527" inside "SF-0109-16-11-152724" out.
  const NUMERIC = /(?<![\d/.\-])(\d{1,2})([/.\-])(\d{1,2})\2(\d{2}|\d{4})(?![\d/.\-])/g;
  const candidates: { date: Date; score: number }[] = [];

  lines.forEach((line) => {
    const low = norm(line);
    if (NOT_DATE.test(low)) return;
    // On a KuDE photo "Emisión" survives where "Fecha" is lost.
    const labelled = /fecha|emisi/.test(low);

    for (const m of line.matchAll(NUMERIC)) {
      const day = Number(m[1]);
      const month = Number(m[3]);
      const rawYear = Number(m[4]);
      const year = (m[4] as string).length === 2 ? 2000 + rawYear : rawYear;
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const date = new Date(Date.UTC(year, month - 1, day));
      // Reject 31/02 and friends: Date rolls them over silently.
      if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
      if (!plausible(date)) continue;
      candidates.push({ date, score: labelled ? 100 : 10 });
    }

    const written = low.match(/(\d{1,2})\s*de\s*([a-z]+)\s*de\s*(?:20)?(\d{2,4})/);
    if (written) {
      const month = MONTHS[written[2] as string];
      if (month !== undefined) {
        const y = Number(written[3]);
        const date = new Date(Date.UTC(y < 100 ? 2000 + y : y, month, Number(written[1])));
        if (plausible(date)) candidates.push({ date, score: labelled ? 110 : 60 });
      }
    }
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const [first] = candidates as [{ date: Date; score: number }];
  // Unlabelled, with another unlabelled date that disagrees: the label that
  // told them apart was lost — a timbrado's start without its "Vigencia" —
  // and taking the first stored the wrong one. Undecided, then.
  const rival = candidates.some((c) => c.score === first.score && c.date.getTime() !== first.date.getTime());
  if (first.score < 60 && rival) return null;
  return first.date;
}

// ---------------------------------------------------------------------------
// Parties

/** A legal form closing a company name: S.A., S.R.L., E.A.S., S.A.E.C.A. */
const LEGAL_FORM =
  /(?:^|[\s,])(?:s\.?\s?a\.?(?:\s?e\.?\s?c\.?\s?a\.?)?|s\.?\s?r\.?\s?l\.?|e\.?\s?a\.?\s?s\.?|s\.?\s?a\.?\s?c\.?\s?i\.?)(?=$|[\s,\-])/i;

/**
 * The buyer's name, after its label.
 *
 * The label comes in several shapes — "Nombre:", "Nombre o Razón Social:", and
 * on a KuDE "Nombre del Receptor:", which a photo can cut down to "Nombre del"
 * with the name after it. With a colon on the line, the name is what follows
 * it; without one the label's own words are stripped, so "del" is never taken
 * for a name. A label alone on its line takes the next line.
 */
function readReceptorNombre(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] as string).match(/(?:nombre|raz[oó]n\s*social)(.*)$/i);
    if (!m) continue;
    let rest = m[1] as string;
    const colon = rest.indexOf(':');
    rest =
      colon >= 0
        ? rest.slice(colon + 1)
        : rest
            .replace(/^[\s.\-]*(?:o\s+raz[oó]n\s*social|y\s+apellidos?|del?\s+(?:receptor|cliente|comprador))\b/i, '')
            // What a cut photo leaves of "Nombre del Receptor": a lowercase
            // "del". Names are printed in capitals, so "DEL PUERTO" stays.
            .replace(/^[\s.\-]*del(?=\s+\p{Lu}|\s*$)/u, '');
    rest = rest.replace(/^[\s:.\-]+/, '').trim();
    if (!rest) rest = (lines[i + 1] ?? '').trim();
    if (rest.length >= 3 && /\p{L}{2}/u.test(rest)) return rest.slice(0, 60);
  }
  return null;
}

/**
 * A document number as a CDC encodes it: establishment, point of issue and
 * number, zero-padded to 3 + 3 + 7 digits. Null unless it has those parts.
 */
export function docDigits(numeroDoc: string): string | null {
  const parts = numeroDoc.split(/\D+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [est, pto, num] = parts as [string, string, string];
  if (est.length > 3 || pto.length > 3 || num.length > 7) return null;
  return est.padStart(3, '0') + pto.padStart(3, '0') + num.padStart(7, '0');
}

/**
 * Every CDC printed on the page whose check digit holds — sometimes in groups
 * of four — except on a line that names another document ("CDC asociado" on a
 * credit note).
 */
function printedCdcs(lines: string[]): string[] {
  const found = new Set<string>();
  for (const line of lines) {
    if (/asociad|referenc/i.test(line)) continue;
    for (const m of line.matchAll(/(?<!\d)(\d{4}(?:[ \t]?\d{4}){10})(?!\d)/g)) {
      const c = (m[1] as string).replace(/\s/g, '');
      if (isValidCdcCheckDigit(c)) found.add(c);
    }
  }
  return [...found];
}

/**
 * The CDC printed on a KuDE, when it is certainly this invoice's.
 *
 * Its check digit is not enough: modulo 11 with weights 2..11 gives the four
 * digits under weight 11 no say, so a misread there still "validates". But a
 * CDC encodes the issuer's RUC, the document number and the issue date, and
 * the photo printed all three: it is kept only when they match, which covers
 * three of those four digits; the fourth, the emission type, can only be 1 or
 * 2 here. Two different CDCs on one page leave it undecided, and only an
 * invoice (type 01) keys a photo.
 */
function readCdc(
  printed: string[],
  ruc: string | null,
  numeroDoc: string | null,
  fecha: Date | null,
): string | null {
  const doc = numeroDoc ? docDigits(numeroDoc) : null;
  if (!ruc || !doc || !fecha || printed.length !== 1) return null;
  const ymd = fecha.toISOString().slice(0, 10).replace(/-/g, '');

  const [c] = printed as [string];
  const matches =
    c.startsWith('01') &&
    Number(c.slice(2, 10)) === Number(ruc) &&
    c.slice(11, 24) === doc &&
    c.slice(25, 33) === ymd &&
    (c[33] === '1' || c[33] === '2');
  return matches ? c : null;
}

// ---------------------------------------------------------------------------

export function parseReceipt(text: string): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => fixLabelTypos(l.trim()))
    .filter(Boolean);
  const flat = lines.join('\n');
  const low = norm(flat);

  const timbrado = flat.match(/timbrado\s*n?[°º:.\s]*(\d{6,10})/i)?.[1] ?? null;

  const numeroDoc =
    flat
      .match(/(?<![\d-])(\d{3}\s*[-–]\s*\d{3}\s*[-–\s]\s*\d{6,7})(?![\d-])/)?.[1]
      ?.replace(/\s+/g, ' ')
      .trim() ?? null;

  // Header is the top of the ticket, by line index — using string containment
  // made a line that happens to repeat later fall in both halves.
  const headerEnd = lines.findIndex((l) =>
    /fecha\s*de\s*emisi|fecha\s*\/\s*hora|cod\.?\s*descrip/i.test(l),
  );
  const header = lines.slice(0, headerEnd > 0 ? headerEnd : Math.min(8, lines.length));
  const emisor = findRuc(header.join('\n'));

  // The customer's RUC/CI is printed against a label near the foot.
  const recIndex = lines.findIndex(
    (l) => /c\.?\s*i\.?\s*(?:o|\/)?\s*r\.?\s*u\.?\s*c|\bruc\b/i.test(l) && !header.includes(l),
  );
  // On the label's line, or — when the photo's layout splits them — the next.
  const receptorRuc =
    recIndex >= 0
      ? ((findRuc(lines[recIndex] as string) ?? findRuc(lines[recIndex + 1] ?? ''))?.ruc ?? null)
      : null;

  const noise =
    /timbrado|factura|kude|^ruc|fecha|vigencia|contado|credito|tel[:.]|www\.|venta|comercio|avda|calle|casa central/i;
  const nameLike = (l: string) => l.length >= 4 && !noise.test(l) && /[a-zA-ZÁÉÍÓÚÑ]{3}/.test(l);
  // The registered name carries its legal form. Above it a KuDE prints the
  // shop's logo ("AP FOX"), which is a brand, not the issuer.
  // …but not the buyer's, whose company can carry one too.
  const buyerLabel = /nombre|az[oó]n\s*social|liente|se[ñn]or|\bsres?\b|\bsr\.?\s*\(es\)/i;
  const emisorNombre =
    header.find((l) => nameLike(l) && !buyerLabel.test(l) && LEGAL_FORM.test(l)) ??
    header.find(nameLike) ??
    null;

  const receptorNombre = readReceptorNombre(lines);

  const fechaEmision = readDate(lines);

  // A credit or debit note, by its title anywhere on the page — a photo often
  // loses the accent, or the title line — or by the type its own CDC encodes.
  const printed = printedCdcs(lines);
  const titles = norm(lines.filter((l) => !/asociad|referenc/i.test(l)).join('\n'));
  const nota =
    /nota\s*de\s*credito/.test(titles) || printed.some((c) => c.startsWith('05'))
      ? 'credito'
      : /nota\s*de\s*debito/.test(titles) || printed.some((c) => c.startsWith('06'))
        ? 'debito'
        : null;
  const cdc = nota ? null : readCdc(printed, emisor?.ruc ?? null, numeroDoc, fechaEmision);

  const exentasLine = lines.find((l) => /exent/i.test(norm(l)));
  const exentas = exentasLine ? lastNumber(exentasLine) : null;

  // The best-ranked total, checked against the footer's own arithmetic. There
  // is deliberately no search for a lower-ranked total that "fits": one such
  // search swapped a correct total for a gravada line when a rate went unread.
  // A contradiction is reported, and importPhoto asks for the photo again.
  // "TOTAL IVA", or a KuDE's "Liquidación Total del IVA": both rates summed,
  // printed. Read beside its label only — it is a check, not a figure to
  // borrow from a neighbouring line — never from a per-rate or "incluido"
  // line, and from the first one that carries an amount: the first match can
  // be the item table's header ("CANTIDAD UNITARIO TOTAL IVA"), which
  // silently switched the check off.
  const totalIva =
    lines
      .map((l) => {
        const n = norm(l);
        return /\btotal\s+(?:del\s+)?iva\b/.test(n) && !/%|incl/.test(n) ? lastNumber(l) : null;
      })
      .find((v) => v != null) ?? null;

  const best = totalCandidates(lines)[0] ?? null;
  const fiscal = readFiscal(lines, best?.value ?? null);
  let agree = totalsAgree(best?.value ?? null, fiscal, exentas, readRounding(lines));
  if (!ratesAgree(fiscal) || !ivaSumAgrees(fiscal, totalIva)) agree = false;
  // An amount taken from the line under its label may belong to another label
  // — a KuDE's last item sits right under "Total:" — so it stands only when
  // the footer confirms it.
  const total = best && (!best.borrowed || agree === true) ? best.value : null;
  const { gravada5, gravada10, iva5, iva10 } = fiscal;

  const parsed: ParsedReceipt = {
    emisorRuc: emisor?.ruc ?? null,
    emisorDv: emisor?.dv ?? null,
    emisorNombre,
    receptorRuc,
    receptorNombre,
    timbrado,
    numeroDoc,
    fechaEmision,
    total,
    gravada5,
    gravada10,
    exentas,
    iva5,
    iva10,
    totalIva,
    cdc,
    nota,
    totalsAgree: agree,
    derived: fiscal.derived ?? [],
    missing: [],
    confidence: 0,
  };

  const required: [keyof ParsedReceipt, string][] = [
    ['emisorRuc', 'RUC del emisor'],
    ['emisorNombre', 'Nombre del emisor'],
    ['fechaEmision', 'Fecha'],
    ['total', 'Total'],
  ];
  parsed.missing = required.filter(([k]) => parsed[k] == null).map(([, label]) => label);

  // The IVA is what the whole feature exists for, so its absence is worth
  // saying out loud rather than silently storing zero.
  // An exempt-only invoice has no IVA to read: its exentas are its total. Not
  // when the page prints a gravada or IVA label, though — then its IVA footer
  // was lost, not absent: a scrambled photo read as "Gs 16, all exempt".
  const fiscalLabel = lines.some((l) => /gravad|liquidac|\btotal\s+(?:del\s+)?iva\b/.test(norm(l)));
  const exemptOnly =
    agree === true && exentas != null && gravada5 == null && gravada10 == null && !fiscalLabel;
  if (parsed.iva5 == null && parsed.iva10 == null && !exemptOnly) parsed.missing.push('IVA');
  // Read, but contradicted by the footer's own sum: say so rather than store
  // it as if it were sound. This is also what gets the layout logged.
  if (agree === false) parsed.missing.push(TOTALS_DISAGREE);

  const signals = [
    parsed.emisorRuc,
    parsed.emisorNombre,
    parsed.fechaEmision,
    parsed.total,
    parsed.iva5 != null || parsed.iva10 != null ? 1 : null,
    parsed.numeroDoc ?? parsed.timbrado,
  ];
  parsed.confidence = signals.filter(Boolean).length / signals.length;
  if (agree === false) parsed.confidence = Math.min(parsed.confidence, 0.5);

  return parsed;
}

/**
 * How far a reading holds together. Used to choose between two layouts of the
 * same photo: a wrong layout pairs labels with the wrong amounts, and the
 * footer's arithmetic is what catches it.
 */
export function readingScore(p: ParsedReceipt): number {
  let score = 0;
  if (p.total != null) score += 4;
  if (p.totalsAgree === true) score += 4;
  if (p.totalsAgree === false) score -= 4;
  if (p.iva5 != null || p.iva10 != null) score += 2;
  if (p.totalIva != null && Math.abs((p.iva5 ?? 0) + (p.iva10 ?? 0) - p.totalIva) <= 2) score += 1;
  for (const v of [p.emisorRuc, p.fechaEmision, p.emisorNombre, p.numeroDoc ?? p.timbrado, p.cdc]) {
    if (v != null) score += 1;
  }
  // Read beats computed: of two readings that agree, the one that read a
  // gravada has its printed figure, not one rounded back from the IVA.
  return score - p.derived.length;
}

export interface Reading {
  layout: string;
  text: string;
  parsed: ParsedReceipt;
}

/**
 * Parses each candidate text and keeps the reading that holds together best —
 * on a tie, the earlier candidate. Null when no candidate has text.
 */
export function parseBest(
  candidates: { layout: string; text: string | null | undefined }[],
): Reading | null {
  const readings: Reading[] = [];
  for (const c of candidates) {
    if (c.text) readings.push({ layout: c.layout, text: c.text, parsed: parseReceipt(c.text) });
  }
  let best: Reading | null = null;
  for (const r of readings) {
    if (!best || readingScore(r.parsed) > readingScore(best.parsed)) best = r;
  }
  if (!best) return null;

  // Two layouts of one photo that read two different totals: only a total its
  // own footer confirms may stand. Otherwise neither is known, and the photo
  // is asked for again rather than one picked by score — a reading with
  // nothing to check its Gs 29 against outranked a contradicted Gs 223.150.
  const p = best.parsed;
  const chosen = best;
  const contested = readings.some(
    (r) => r !== chosen && r.parsed.total != null && r.parsed.total !== p.total,
  );
  if (p.total != null && p.totalsAgree !== true && contested) {
    p.total = null;
    if (!p.missing.includes('Total')) p.missing.push('Total');
  }

  // Two readings that both add up, but split the amounts differently: the
  // arithmetic cannot say which is right — a levelled and an unbent reading of
  // one keystoned KuDE put its 10% amount on different lines — so neither is
  // stored.
  const splits = readings.some(
    (r) =>
      r !== chosen &&
      r.parsed.total != null &&
      r.parsed.totalsAgree === true &&
      (Object.keys(SAME_AMOUNT) as (keyof typeof SAME_AMOUNT)[]).some(
        (k) => Math.abs((r.parsed[k] ?? 0) - (p[k] ?? 0)) > SAME_AMOUNT[k],
      ),
  );
  if (p.totalsAgree === true && splits) {
    p.totalsAgree = false;
    p.missing.push(TOTALS_DISAGREE);
  }

  // A note is a note, whichever reading found its title.
  p.nota ??= readings.find((r) => r.parsed.nota)?.parsed.nota ?? null;
  return best;
}

/** How far two readings' amounts may differ and still be the same figures. */
const SAME_AMOUNT = { total: 0, gravada5: 21, gravada10: 11, iva5: 2, iva10: 2 } as const;

/**
 * Stable identifier for a paper invoice, used where an electronic one has its
 * CDC. Built from issuer + document number so photographing the same invoice
 * twice deduplicates instead of creating a second record.
 */
export function receiptKey(p: ParsedReceipt): string {
  const parts = [
    p.emisorRuc ?? 'sinruc',
    p.numeroDoc?.replace(/\s+/g, '') ?? p.timbrado ?? 'sinnro',
    p.fechaEmision ? p.fechaEmision.toISOString().slice(0, 10) : 'sinfecha',
    p.total != null ? String(Math.round(p.total)) : 'sintotal',
  ];
  return `OCR:${parts.join(':')}`;
}

/** Labels kept verbatim in a layout skeleton; everything else is masked. */
const LAYOUT_KEYWORDS = new Set([
  'total', 'totales', 'sub', 'subtotal', 'a', 'pagar', 'importe', 'neto',
  'gravada', 'gravadas', 'gravado', 'exenta', 'exentas', 'iva', 'liquidacion',
  'impuesto', 'gs', 'fecha', 'hora', 'ruc', 'timbrado', 'factura', 'nombre',
  'contado', 'credito', 'redondeo', 'descuento', 'del', 'de',
]);

/**
 * The layout of an OCR text with its content removed — safe to log.
 *
 * Diagnosing a parse failure needs the SHAPE: which label sits on which line
 * and where the numbers fall. It does not need the values, and a receipt's
 * text carries the buyer's name and CI/RUC. So fiscal keywords survive
 * verbatim, every other word becomes "w" and every digit "9":
 *     "Nombre: ALBERTO VELAZQUEZ"  ->  "nombre: w w"
 *     "TOTAL GS: 223.150"          ->  "total gs: 999.999"
 * Letters are matched as Unicode letters, so an accented name cannot leak a
 * character through an ASCII-only pattern.
 */
export function layoutSkeleton(text: string, maxChars = 1500): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\d/g, '9')
        .replace(/\p{L}+/gu, (word) => (LAYOUT_KEYWORDS.has(norm(word)) ? norm(word) : 'w')),
    )
    .join('\n')
    .slice(0, maxChars);
}
