import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  officialRate,
  parseDnitRates,
  pickRate,
  resetRatesCache,
} from '../src/services/exchange-rates';

/**
 * The rate for an invoice in another currency that prints none: the DNIT's
 * close of the day before (Decreto 3107/2019, art. 13). The table is the
 * DNIT's own page as served on 2026-09-21, trimmed to three months.
 */

const html = readFileSync(join(__dirname, 'fixtures', 'dnit', 'cotizaciones-2026.html'), 'utf8');
const rates = parseDnitRates(html);
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

afterEach(() => resetRatesCache());

describe("the DNIT's table", () => {
  it('reads every currency of every day, buying and selling', () => {
    expect(rates.get('2026-08-28|USD')).toEqual({ compra: 5915.26, venta: 5921.39 });
    expect(rates.get('2026-09-01|USD')).toEqual({ compra: 5909.01, venta: 5919.15 });
    expect(rates.get('2026-09-01|BRL')).toEqual({ compra: 1148.05, venta: 1150.29 });
    expect(rates.get('2026-09-01|EUR')).toEqual({ compra: 6849.73, venta: 6861.48 });
    // A weekend carries Friday's close: 28 August 2026 was a Friday.
    expect(rates.get('2026-08-30|USD')).toEqual(rates.get('2026-08-28|USD'));
  });

  it('reads nothing from a page that is not the table', () => {
    expect(parseDnitRates('<html><body>Mantenimiento</body></html>').size).toBe(0);
  });
});

describe('the rate for an invoice', () => {
  it("is the day before's close: the selling rate for a purchase, the buying rate for a sale", () => {
    // Residencial Domicia, USD 500 issued Monday 31/08/2026: Sunday's row,
    // which carries Friday's close.
    expect(pickRate(rates, 'USD', day('2026-08-31'), 'venta')).toEqual({
      rate: 5921.39,
      date: '2026-08-30',
      side: 'venta',
    });
    expect(pickRate(rates, 'USD', day('2026-08-31'), 'compra')).toMatchObject({ rate: 5915.26 });
    // Across a month: 1 September takes 31 August.
    expect(pickRate(rates, 'USD', day('2026-09-01'), 'venta')).toMatchObject({
      rate: 5912.9,
      date: '2026-08-31',
    });
  });

  it('takes the close a weekend carries before the DNIT publishes it', () => {
    // The table stops on Friday the 18th. An invoice of Monday the 21st needs
    // Sunday's row — which will carry Friday's close.
    expect(pickRate(rates, 'USD', day('2026-09-21'), 'venta')).toMatchObject({
      rate: 5956.06,
      date: '2026-09-20',
    });
  });

  it('waits for a business day the DNIT has not published', () => {
    // Tuesday the 22nd needs Monday's close, which is not out yet.
    expect(pickRate(rates, 'USD', day('2026-09-22'), 'venta')).toBe('pendiente');
  });

  it('has none for a currency the DNIT does not quote', () => {
    expect(pickRate(rates, 'OTRA', day('2026-08-31'), 'venta')).toBe('moneda');
  });

  it("says so when the DNIT's page cannot be read", async () => {
    // Tests never reach the site (DNIT_RATES=off), as production cannot when it is down.
    await expect(officialRate('USD', day('2026-08-31'), 'venta')).resolves.toBe('sin-conexion');
    resetRatesCache(rates);
    await expect(officialRate('USD', day('2026-08-31'), 'venta')).resolves.toMatchObject({
      rate: 5921.39,
    });
  });
});
