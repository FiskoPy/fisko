import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../src/config/env';
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

  it('reads a day the DNIT wrote the other way round', () => {
    // 15-17/03/2024 were published as "7,299.26".
    const page = html.replace(
      '<td align="center">5.909,01</td>',
      '<td align="center">5,909.01</td>',
    );
    expect(parseDnitRates(page).get('2026-09-01|USD')).toEqual({ compra: 5909.01, venta: 5919.15 });
  });

  it('reads three decimals as decimals', () => {
    // "9.436,253": the pound's buying rate, 20-22/08/2021.
    const page = html.replace('<td style="text-align: center;">7.993,12</td>', '<td style="text-align: center;">7.993,125</td>');
    expect(parseDnitRates(page).get('2026-09-01|GBP')?.compra).toBe(7993.125);
  });
});

describe('the rate for an invoice', () => {
  it("is the day before's close: the selling rate for a purchase, the buying rate for a sale", () => {
    // Residencial Domicia, USD 500 issued Monday 31/08/2026: Sunday's row,
    // which carries Friday's close.
    expect(pickRate(rates, 'USD', day('2026-08-31'), 'venta')).toEqual({
      rate: 5921.39,
      // The buying close too, for a change of side without a second lookup.
      other: 5915.26,
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

  it('does not take an older close for a day it could not read', () => {
    // Every calendar day has a row; one missing inside the table was
    // unreadable, not a holiday.
    const gap = new Map(rates);
    gap.delete('2026-08-30|USD');
    expect(pickRate(gap, 'USD', day('2026-08-31'), 'venta')).toBe('ilegible');
  });

  it('does not take a close far from the days around it — a typo in the table', () => {
    const typo = new Map(rates);
    typo.set('2026-08-30|USD', { compra: 5_915_260, venta: 5_921_390 });
    expect(pickRate(typo, 'USD', day('2026-08-31'), 'venta')).toBe('ilegible');
  });

  it('answers a day already published with no request — the site went 404 the night it was read', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('should not be called'));
    vi.stubGlobal('fetch', fetchMock);
    env.DNIT_RATES = 'on';
    try {
      // Residencial Domicia's rate, from the snapshot of the DNIT's page.
      await expect(officialRate('USD', day('2026-08-31'), 'venta')).resolves.toMatchObject({
        rate: 5921.39,
        other: 5915.26,
        date: '2026-08-30',
      });
      await expect(officialRate('EUR', day('2019-03-15'), 'compra')).resolves.toMatchObject({ date: '2019-03-14' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      env.DNIT_RATES = 'off';
      vi.unstubAllGlobals();
    }
  });

  it("says so when a day past what is known cannot be read", async () => {
    // Tests never reach the site (DNIT_RATES=off), as production cannot when it is down.
    await expect(officialRate('USD', day('2026-09-23'), 'venta')).resolves.toBe('sin-conexion');
  });

  it("reads the month's own article when the page with every month is gone", async () => {
    // The article at "…-mes-de-agosto-2026" holds September's table; this
    // one has gained Monday the 21st.
    const september = html.split('data-analytics-asset-title="')[1] as string;
    const article = `<div data-analytics-asset-title="${september.replace(
      '<td align="center">18</td>',
      '<td align="center">21</td><td align="center">5.931,00</td><td align="center">5.940,00</td></tr><tr><td align="center">18</td>',
    )}`;
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('tipos-de-cambios-del-mes-de-agosto-2026')
        ? { ok: true, status: 200, text: async () => article }
        : { ok: false, status: 404, text: async () => 'not found' },
    );
    vi.stubGlobal('fetch', fetchMock);
    env.DNIT_RATES = 'on';
    try {
      await expect(officialRate('USD', day('2026-09-22'), 'venta')).resolves.toMatchObject({
        rate: 5940,
        date: '2026-09-21',
      });
      expect(fetchMock.mock.calls.map(([u]) => (u as string).split('/').pop())).toEqual([
        'cotizaciones',
        'tipos-de-cambios-del-mes-de-agosto-2026',
      ]);
    } finally {
      env.DNIT_RATES = 'off';
      vi.unstubAllGlobals();
    }
  });

  it('does not ask a site that is down again for every invoice', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT'));
    vi.stubGlobal('fetch', fetchMock);
    env.DNIT_RATES = 'on';
    try {
      await expect(officialRate('USD', day('2026-09-23'), 'venta')).resolves.toBe('sin-conexion');
      const tried = fetchMock.mock.calls.length; // the page, then the month's articles
      await expect(officialRate('USD', day('2026-09-24'), 'venta')).resolves.toBe('sin-conexion');
      expect(fetchMock).toHaveBeenCalledTimes(tried);
    } finally {
      env.DNIT_RATES = 'off';
      vi.unstubAllGlobals();
    }
  });
});
