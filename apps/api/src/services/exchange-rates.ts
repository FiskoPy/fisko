import { env } from '../config/env';
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
 */

export type RateSide = 'compra' | 'venta';

export interface OfficialRate {
  rate: number;
  /** The day whose close it is, YYYY-MM-DD: the day before the invoice. */
  date: string;
  side: RateSide;
}

export type RateMiss = 'moneda' | 'pendiente' | 'sin-conexion';

type DayRates = Map<string, { compra: number; venta: number }>;

const PAGE = 'https://www.dnit.gov.py/web/portal-institucional/cotizaciones';
const TIMEOUT_MS = 20_000;
/** The table gains a row each business day; older months never change. */
const FRESH_MS = 60 * 60 * 1000;

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

/** "5.921,39" → 5921.39 */
const rateOf = (cell: string | undefined): number | null => {
  if (!cell || !/^\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^\d+(?:,\d+)?$/.test(cell)) return null;
  const n = Number(cell.replace(/\./g, '').replace(',', '.'));
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

let cache: { at: number; rates: DayRates } | null = null;

async function fetchRates(): Promise<DayRates | null> {
  if (env.DNIT_RATES === 'off') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(PAGE, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 Fisko' } });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'DNIT rates page answered an error');
      return null;
    }
    const rates = parseDnitRates(await res.text());
    if (!rates.size) {
      logger.warn('DNIT rates page carried no rates — its layout may have changed');
      return null;
    }
    return rates;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'DNIT rates page could not be read');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function ratesTable(fresh: boolean): Promise<DayRates | null> {
  if (cache && (!fresh || Date.now() - cache.at < FRESH_MS)) return cache.rates;
  const rates = await fetchRates();
  if (rates) cache = { at: Date.now(), rates };
  // A stale table still answers for the days it has.
  return cache?.rates ?? null;
}

const dayBefore = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
const ymdOf = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The close to use for [currency] on an invoice issued on [issued]: the row
 * of the day before.
 *
 * A row the table lacks inside its range is a holiday, and carries the last
 * close before it. Past its last row, the day is not published yet; only a
 * weekend in between carries a close it already has.
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

  for (let back = 0; back <= 6; back++) {
    const day = new Date(want.getTime() - back * 86_400_000);
    const ymd = ymdOf(day);
    if (ymd > last) {
      // Not published yet: fine only if the day is a Saturday or a Sunday,
      // which carries Friday's close anyway.
      const weekday = day.getUTCDay();
      if (weekday !== 0 && weekday !== 6) return 'pendiente';
      continue;
    }
    const row = rates.get(`${ymd}|${currency}`);
    if (row) return { rate: row[side], date: ymdOf(want), side };
  }
  return 'pendiente';
}

/** The official close for an invoice, or why there is none. */
export async function officialRate(
  currency: string,
  issued: Date,
  side: RateSide,
): Promise<OfficialRate | RateMiss> {
  const cached = await ratesTable(false);
  let picked = cached ? pickRate(cached, currency, issued, side) : 'sin-conexion';
  // The day may have been published since the table was read.
  if (picked === 'pendiente' || picked === 'sin-conexion') {
    const fresh = await ratesTable(true);
    if (fresh) picked = pickRate(fresh, currency, issued, side);
  }
  return picked;
}

/** For tests: forget the table read so far. */
export function resetRatesCache(rates: DayRates | null = null): void {
  cache = rates ? { at: Date.now(), rates } : null;
}
