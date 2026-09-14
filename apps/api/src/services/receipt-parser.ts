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
  const re = /(?<!\d)0?(10|5)\s*%\s*\)?[\s:.]*(?:g\s*s\.?|g\$|₲)?[\s:.]*(\d[\d.,]*)/gi;

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
      } else if (!isTax) {
        out[`gravada${rate}`] ??= f.value;
      }
    }

    // One side read, the other derivable by the rule the invoice itself obeys.
    const g = out[`gravada${rate}`];
    const i = out[`iva${rate}`];
    if (g != null && i == null) out[`iva${rate}`] = Math.round(g / d);
    else if (g == null && i != null) out[`gravada${rate}`] = Math.round(i * d);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Total

/** Labels that carry a total but not THE total. */
const NOT_TOTAL =
  /sub\s*-?\s*total|total\s+exent|total\s+gravad|total\s+iva|liquidac|total\s+descuent|acumulad|puntos|saldo|ahorro|anterior|redondeo|res\.?\s*\d+/;

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
  [/\btotal\b/, 40],
];

function readTotal(lines: string[]): number | null {
  let best: { rank: number; value: number } | null = null;

  lines.forEach((line, i) => {
    const low = norm(line);
    if (NOT_TOTAL.test(low)) return;
    const hit = TOTAL_LABELS.find(([re]) => re.test(low));
    if (!hit) return;
    // Same line first; failing that, a next line holding only the amount.
    const value = lastNumber(line) ?? amountOnly(lines[i + 1]);
    if (value == null || value <= 0) return;
    // Later wins on a tie: the payable total is printed below the breakdown.
    if (!best || hit[1] >= best.rank) best = { rank: hit[1], value };
  });

  // Deliberately no "largest number in the document" fallback. On a till
  // receipt the largest number is a unit price or an order number, and a
  // plausible-looking wrong total is worse than none: the app can ask.
  return best ? (best as { value: number }).value : null;
}

// ---------------------------------------------------------------------------
// Date

/** Labels whose date is not the date of the sale. */
const NOT_DATE =
  /vigencia|vencimiento|valido|vence|timbrado|pedido|nro|numero|n°|cdc|autorizac|orden|caducidad/;

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
    const labelled = /fecha/.test(low);

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
  return (candidates[0] as { date: Date }).date;
}

// ---------------------------------------------------------------------------

export function parseReceipt(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
  const recLine = lines.find((l) =>
    /c\.?\s*i\.?\s*(?:o|\/)?\s*r\.?\s*u\.?\s*c|\bruc\b/i.test(l) && !header.includes(l),
  );
  const receptorRuc = recLine ? (findRuc(recLine)?.ruc ?? null) : null;

  const noise =
    /timbrado|factura|^ruc|fecha|vigencia|contado|credito|tel[:.]|www\.|venta|comercio|avda|calle|casa central/i;
  const emisorNombre =
    header.find((l) => l.length >= 4 && !noise.test(l) && /[a-zA-ZÁÉÍÓÚÑ]{3}/.test(l)) ?? null;

  const receptorNombre =
    flat.match(/(?:nombre|raz[oó]n\s*social)\s*[:.]?\s*([^\n]{3,60})/i)?.[1]?.trim() ?? null;

  const fechaEmision = readDate(lines);
  const total = readTotal(lines);
  const { gravada5, gravada10, iva5, iva10 } = readFiscal(lines, total);

  const exentasLine = lines.find((l) => /exent/i.test(norm(l)));
  const exentas = exentasLine ? lastNumber(exentasLine) : null;

  const totalIvaLine = lines.find((l) => /^total\s+iva/.test(norm(l)));
  const totalIva = totalIvaLine ? lastNumber(totalIvaLine) : null;

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
  if (parsed.iva5 == null && parsed.iva10 == null) parsed.missing.push('IVA');

  const signals = [
    parsed.emisorRuc,
    parsed.emisorNombre,
    parsed.fechaEmision,
    parsed.total,
    parsed.iva5 != null || parsed.iva10 != null ? 1 : null,
    parsed.numeroDoc ?? parsed.timbrado,
  ];
  parsed.confidence = signals.filter(Boolean).length / signals.length;

  return parsed;
}

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
