import { env } from '../config/env';
import { DNIT_SNAPSHOT, DNIT_SNAPSHOT_CURRENCIES } from '../data/dnit-snapshot';
import { logger } from '../lib/logger';

/**
 * The exchange rate the law names for an invoice in another currency that does
 * not print its own.
 *
 * Decreto 3107/2019, art. 13: the amount "se convertirá a moneda nacional al
 * tipo de cambio comprador o vendedor, en el mercado libre a nivel bancario al
 * cierre del día anterior en que se realizó la operación, dispuestas por el
 * Banco Central del Paraguay y publicadas en la página Web de la
 * Administración Tributaria, o la cotización consignada en el correspondiente
 * comprobante de venta".
 *
 * The DNIT publishes those closes month by month, a row per calendar day: a
 * weekend or a holiday carries the last business day's close (04, 05 and 06
 * of September 2026 — a Friday and its weekend — read the same). A purchase is
 * converted at the selling rate, the one the buyer pays for the currency; a
 * sale at the buying rate.
 *
 * Where the closes come from, in order: a snapshot of the DNIT's table from
 * 2019 to 18/09/2026 (data/dnit-snapshot), so a day long published never
 * depends on a site staying up; then what was read live since the process
 * started — the page with every month, and, that page having gone 404 on the
 * night of 2026-09-21, the month's own article. When nothing answers, the
 * caller stores the invoice without a rate and fills it in later
 * (pending-rates), rather than refuse an invoice it read.
 */

export type RateSide = 'compra' | 'venta';

export interface OfficialRate {
  rate: number;
  /** The same close on the other side — kept so a change of side needs no second lookup. */
  other: number;
  /** The day whose close it is, YYYY-MM-DD: the day before the invoice. */
  date: string;
  side: RateSide;
}

export type RateMiss = 'moneda' | 'pendiente' | 'ilegible' | 'sin-conexion';

type DayRates = Map<string, { compra: number; venta: number }>;

const PAGE = 'https://www.dnit.gov.py/web/portal-institucional/cotizaciones';
const ARTICLES = 'https://www.dnit.gov.py/web/portal-institucional/softwares-y-sistemas/-/asset_publisher/aere/content/';
/** Vision can take 25 s of the app's 60: the rate gets what is left, and less. */
const TIMEOUT_MS = 8_000;
/** A month read live is not read again for a day it lacks before this long. */
const FRESH_MS = 60 * 60 * 1000;
/** After a failed read, the site is left alone this long: an outage is not retried per invoice. */
const BACKOFF_MS = 5 * 60 * 1000;

/** The table's column headings, and the currency each one is. */
const COLUMNS: [RegExp, string][] = [
  [/^d[oó]lar/i, 'USD'],
  [/^real/i, 'BRL'],
  [/^peso\s*arg/i, 'ARS'],
  [/^yen/i, 'JPY'],
  [/^euro/i, 'EUR'],
  [/^libra/i, 'GBP'],
];

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const cellsOf = (row: string): string[] =>
  [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
    (m[1] as string)
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim(),
  );

/**
 * "5.921,39" → 5921.39, the DNIT's own way — also with three decimals,
 * "9.436,253" (GBP, 20-22/08/2021) — and "7,299.26", the way it wrote a few
 * days (15-17/03/2024, 31/05/2021, 29/07-02/08/2020). With both separators
 * the last one is the decimal point; a comma alone is one; a point alone is
 * one unless three digits follow it, which is grouping.
 */
const rateOf = (cell: string | undefined): number | null => {
  const s = cell?.trim() ?? '';
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const comma = s.lastIndexOf(',');
  const point = s.lastIndexOf('.');
  const decimalAt =
    comma >= 0 && point >= 0 ? Math.max(comma, point) : comma >= 0 ? comma : point >= 0 && !/\.\d{3}$/.test(s) ? point : -1;
  const whole = (decimalAt >= 0 ? s.slice(0, decimalAt) : s).replace(/[.,]/g, '');
  const n = Number(decimalAt >= 0 ? `${whole}.${s.slice(decimalAt + 1)}` : whole);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Every rate on the DNIT's page, keyed "YYYY-MM-DD|USD". Each month is an
 * article titled "Tipos de cambios del mes de Agosto 2026" holding one table:
 * a row of currency headings, a row of Compra/Venta, then a row per day.
 */
export function parseDnitRates(html: string): DayRates {
  const out: DayRates = new Map();
  const articles = html.split(/data-analytics-asset-title="/).slice(1);
  for (const article of articles) {
    const title = article.slice(0, article.indexOf('"'));
    const when = title.toLowerCase().match(/mes\s+de\s+([a-z]+)\s+(\d{4})/);
    const month = when ? MESES[when[1] as string] : undefined;
    if (!when || !month) continue;
    const year = Number(when[2]);
    const end = article.indexOf('</table>');
    if (end < 0) continue;
    const rows = [...article.slice(0, end).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
      cellsOf(m[1] as string),
    );
    // The heading row names the currencies, each spanning its two columns.
    const heading = rows.find((cells) => cells.some((c) => COLUMNS.some(([re]) => re.test(c))));
    if (!heading) continue;
    const currencies = heading
      .filter((c) => c !== '')
      .map((c) => COLUMNS.find(([re]) => re.test(c))?.[1] ?? null);
    for (const cells of rows) {
      const day = cells[0]?.match(/^(\d{1,2})$/)?.[1];
      if (!day) continue;
      const date = new Date(Date.UTC(year, month - 1, Number(day)));
      if (date.getUTCMonth() !== month - 1) continue;
      const ymd = date.toISOString().slice(0, 10);
      currencies.forEach((currency, k) => {
        const compra = rateOf(cells[1 + 2 * k]);
        const venta = rateOf(cells[2 + 2 * k]);
        if (currency && compra && venta) out.set(`${ymd}|${currency}`, { compra, venta });
      });
    }
  }
  return out;
}

const dayBefore = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
const ymdOf = (d: Date): string => d.toISOString().slice(0, 10);

let snapshotRates: DayRates | null = null;

/** The closes read from the DNIT's page on 2026-09-21 (see data/dnit-snapshot). */
function snapshot(): DayRates {
  if (snapshotRates) return snapshotRates;
  const out: DayRates = new Map();
  for (const line of DNIT_SNAPSHOT.split('\n')) {
    const [date, ...columns] = line.split('|');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    columns.forEach((column, k) => {
      const [compra, venta] = column.split(' ').map(Number);
      const currency = DNIT_SNAPSHOT_CURRENCIES[k];
      if (currency && compra && venta) out.set(`${date}|${currency}`, { compra, venta });
    });
  }
  snapshotRates = out;
  return out;
}

/** What was read live since the process started, over the snapshot. */
let live: DayRates = new Map();
let known: DayRates | null = null;
/** When each month ('YYYY-MM') was last read live, and when a read last failed. */
const readAt = new Map<string, number>();
let failedAt = 0;

/** The snapshot with whatever was read live over it. */
function knownRates(): DayRates {
  if (known) return known;
  known = new Map(snapshot());
  for (const [k, v] of live) known.set(k, v);
  return known;
}

async function fetchPage(url: string): Promise<DayRates | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const where = url.replace(/^https:\/\/[^/]+/, '');
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 Fisko' } });
    if (!res.ok) {
      logger.warn({ status: res.status, where }, 'DNIT rates page answered an error');
      return null;
    }
    const rates = parseDnitRates(await res.text());
    if (!rates.size) logger.warn({ where }, 'DNIT rates page carried no rates');
    return rates.size ? rates : null;
  } catch (err) {
    logger.warn({ err: (err as Error).message, where }, 'DNIT rates page could not be read');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const MONTH_SLUGS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * The closes of [want]'s month, read live: from the page with every month —
 * and, since that page went 404 on 2026-09-22, from the month's own article.
 * An article's address lags its content by a month (the one at
 * "…-mes-de-agosto-2026" holds September's table), so the previous month's
 * address is tried first, then the month's own. Each article names its month
 * in its title, which is what the rows are filed under.
 */
async function fetchRates(want: Date): Promise<DayRates | null> {
  if (env.DNIT_RATES === 'off') return null;
  const all = await fetchPage(PAGE);
  if (all) return all;
  const out: DayRates = new Map();
  for (const back of [1, 0]) {
    const month = new Date(Date.UTC(want.getUTCFullYear(), want.getUTCMonth() - back, 1));
    const slug = `tipos-de-cambios-del-mes-de-${MONTH_SLUGS[month.getUTCMonth()]}-${month.getUTCFullYear()}`;
    for (const [k, v] of (await fetchPage(`${ARTICLES}${slug}`)) ?? []) out.set(k, v);
    if ([...out.keys()].some((k) => k.startsWith(ymdOf(want)))) break;
  }
  return out.size ? out : null;
}

/**
 * Reads [want]'s month live — unless it was read within the hour (the day is
 * then simply not out yet), or a read failed within five minutes. Whether
 * something readable answered.
 */
async function readLive(want: Date): Promise<boolean> {
  const month = ymdOf(want).slice(0, 7);
  const now = Date.now();
  const last = readAt.get(month);
  if (last != null && now - last < FRESH_MS) return true;
  if (now - failedAt < BACKOFF_MS) return false;
  // The list and the month open together in the app: one read serves both.
  const running = reading.get(month);
  if (running) return running;
  const read = (async () => {
    const rates = await fetchRates(want);
    if (!rates) {
      failedAt = Date.now();
      return false;
    }
    for (const [k, v] of rates) live.set(k, v);
    known = null;
    readAt.set(month, Date.now());
    return true;
  })().finally(() => reading.delete(month));
  reading.set(month, read);
  return read;
}

/** Reads under way, by month. */
const reading = new Map<string, Promise<boolean>>();

/**
 * The close to use for [currency] on an invoice issued on [issued]: the row
 * of the day before.
 *
 * The DNIT prints a row for every calendar day, holidays and weekends
 * carrying the last business close — so a day missing inside the table is a
 * row that could not be read, not a holiday, and an older close is not taken
 * for it. Past the last row, the day is not published yet; only a weekend in
 * between carries a close the table already has.
 */
export function pickRate(
  rates: DayRates,
  currency: string,
  issued: Date,
  side: RateSide,
): OfficialRate | RateMiss {
  const days = [...rates.keys()].filter((k) => k.endsWith(`|${currency}`)).map((k) => k.slice(0, 10));
  if (!days.length) return 'moneda';
  const last = days.reduce((a, b) => (a > b ? a : b));
  const want = dayBefore(issued);
  const date = ymdOf(want);

  let from = date;
  if (date > last) {
    for (let day = want; ymdOf(day) > last; day = dayBefore(day)) {
      const weekday = day.getUTCDay();
      if (weekday !== 0 && weekday !== 6) return 'pendiente';
    }
    from = last;
  }
  const row = rates.get(`${from}|${currency}`);
  if (!row || !likeItsNeighbours(rates, currency, from, row)) return 'ilegible';
  return { rate: row[side], other: row[side === 'compra' ? 'venta' : 'compra'], date, side };
}

/**
 * Whether a day's rates sit near the closest other day's: the DNIT's own
 * table has typos, and one read a thousand times over would go straight
 * into the IVA. A close moves a few percent at most from one day to the
 * next; with no neighbour within a week there is nothing to hold it to.
 */
function likeItsNeighbours(
  rates: DayRates,
  currency: string,
  ymd: string,
  row: { compra: number; venta: number },
): boolean {
  const at = new Date(`${ymd}T00:00:00.000Z`).getTime();
  for (let d = 1; d <= 7; d++) {
    for (const t of [at - d * 86_400_000, at + d * 86_400_000]) {
      const near = rates.get(`${ymdOf(new Date(t))}|${currency}`);
      if (!near) continue;
      const close = (a: number, b: number) => Math.abs(a / b - 1) <= 0.2;
      return close(row.compra, near.compra) && close(row.venta, near.venta);
    }
  }
  return true;
}

/**
 * The official close for an invoice, or why there is none.
 *
 * A day the snapshot or an earlier read has is answered with no request. A
 * day past them — or one that could not be read — is looked for live, once:
 * 'sin-conexion' when nothing answered, 'pendiente' when the DNIT has not
 * published it yet.
 */
export async function officialRate(
  currency: string,
  issued: Date,
  side: RateSide,
): Promise<OfficialRate | RateMiss> {
  const picked = pickRate(knownRates(), currency, issued, side);
  if (typeof picked !== 'string' || picked === 'moneda') return picked;
  if (!(await readLive(dayBefore(issued)))) return picked === 'pendiente' ? 'sin-conexion' : picked;
  return pickRate(knownRates(), currency, issued, side);
}

/** For tests: forget what was read live — or take [rates] as read — and any failure. */
export function resetRatesCache(rates: DayRates | null = null): void {
  live = new Map(rates ?? []);
  known = null;
  readAt.clear();
  failedAt = 0;
}
