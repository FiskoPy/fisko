import { describe, expect, it } from 'vitest';
import { buildInsights, type InsightInput } from '../src/services/fiscal-insights';
import { projectIva } from '../src/services/fiscal-forecast';
import type { FiscalSummary } from '../src/modules/reports/reports.service';

const emptySummary = (over: Partial<FiscalSummary> = {}): FiscalSummary => ({
  period: { from: null, to: null },
  count: 0,
  totalOpe: 0,
  totalIva: 0,
  iva5: 0,
  iva10: 0,
  baseGrav5: 0,
  baseGrav10: 0,
  exentas: 0,
  ventas: 0,
  compras: 0,
  ivaCredito: 0,
  ivaDebito: 0,
  irpEstimado: 0,
  sinConversion: 0,
  documentos: 0,
  sinOperacion: 0,
  byMonth: [],
  byCategory: [],
  ...over,
});

const NOW = new Date('2026-08-20T12:00:00Z');

const input = (over: Partial<InsightInput> = {}): InsightInput => ({
  summary: emptySummary(),
  lastInvoiceAt: null,
  recentCount: 0,
  recentTotal: 0,
  now: NOW,
  ...over,
});

const kinds = (i: ReturnType<typeof buildInsights>) => i.map((x) => x.kind);

describe('buildInsights — spend report', () => {
  it('reports what came in over the 10 days, by the day it was loaded', () => {
    const out = buildInsights(input({ recentCount: 3, recentTotal: 1_250_000 }));
    const gasto = out.find((i) => i.kind === 'gasto_periodo');
    expect(gasto).toBeDefined();
    expect(gasto!.title).toContain('3 comprobante(s)');
    expect(gasto!.body).toContain('1.250.000');
  });

  it('does not call it spending of the period: the invoices can be of another month', () => {
    // August invoices loaded in September read as September's spending, and
    // the client took the figure for his month (2026-09-20).
    const out = buildInsights(input({ recentCount: 5, recentTotal: 35_688_756 }));
    const gasto = out.find((i) => i.kind === 'gasto_periodo');
    expect(gasto!.title).not.toMatch(/gastaste/i);
    expect(gasto!.body).toMatch(/mes que tiene impreso/i);
  });

  it('stays silent when nothing came in', () => {
    expect(kinds(buildInsights(input()))).not.toContain('gasto_periodo');
  });
});

describe('buildInsights — accumulated IVA', () => {
  it('warns when the balance is payable', () => {
    const out = buildInsights(
      input({ summary: emptySummary({ totalIva: 900_000, ivaDebito: 900_000, ivaCredito: 200_000 }) }),
    );
    const iva = out.find((i) => i.kind === 'iva_acumulado')!;
    expect(iva.level).toBe('warning');
    expect(iva.title).toMatch(/a pagar/);
    expect(iva.title).toContain('700.000');
  });

  it('frames a credit balance as in the user favour, not a warning', () => {
    const out = buildInsights(
      input({ summary: emptySummary({ totalIva: 900_000, ivaDebito: 100_000, ivaCredito: 800_000 }) }),
    );
    const iva = out.find((i) => i.kind === 'iva_acumulado')!;
    expect(iva.level).toBe('info');
    expect(iva.title).toMatch(/a favor/);
  });

  it('does not nag below the threshold', () => {
    const out = buildInsights(input({ summary: emptySummary({ totalIva: 100_000 }) }));
    expect(kinds(out)).not.toContain('iva_acumulado');
  });

  it('states the exact day the RUC files on (DNIT perpetual calendar)', () => {
    // A RUC ending in 4 files on the 15th. NOW is 20/08/2026, so the IVA of
    // August is presented on 15/09/2026, a Tuesday.
    const out = buildInsights(
      input({ ruc: '80175384', summary: emptySummary({ totalIva: 900_000 }) }),
    );
    const iva = out.find((i) => i.kind === 'iva_acumulado')!;
    expect(iva.body).toContain('15 de setiembre');
    expect(iva.body).not.toMatch(/alrededor/);
  });

  it('moves a due date off the weekend, and asks for the RUC when it has none', () => {
    // A RUC ending in 0 files on the 7th; 07/02/2027 is a Sunday -> the 8th.
    const out = buildInsights(
      input({
        ruc: '80000000',
        now: new Date('2027-01-20T12:00:00Z'),
        summary: emptySummary({ totalIva: 900_000 }),
      }),
    );
    expect(out.find((i) => i.kind === 'iva_acumulado')!.body).toContain('8 de febrero');

    const sinRuc = buildInsights(input({ summary: emptySummary({ totalIva: 900_000 }) }));
    expect(sinRuc.find((i) => i.kind === 'iva_acumulado')!.body).toMatch(/Cargá tu RUC/);
  });

  it('calls a credit balance what it is: nothing to pay, carried forward', () => {
    const out = buildInsights(
      input({ summary: emptySummary({ totalIva: 900_000, ivaDebito: 0, ivaCredito: 3_244_443 }) }),
    );
    const iva = out.find((i) => i.kind === 'iva_acumulado')!;
    expect(iva.body).toMatch(/No hay IVA a pagar/);
    expect(iva.body).toContain('3.244.443');
  });
});

describe('buildInsights — capture nudge', () => {
  it('invites a user with no invoices to connect their mailbox', () => {
    const out = buildInsights(input());
    const nudge = out.find((i) => i.kind === 'sin_capturas')!;
    expect(nudge.action?.route).toBe('/perfil/email');
  });

  it('nudges after 10 quiet days', () => {
    const out = buildInsights(input({ lastInvoiceAt: new Date('2026-08-05T12:00:00Z') }));
    const nudge = out.find((i) => i.kind === 'sin_capturas')!;
    expect(nudge.level).toBe('warning');
    expect(nudge.title).toContain('15 días');
  });

  it('stays quiet when an invoice arrived recently', () => {
    const out = buildInsights(input({ lastInvoiceAt: new Date('2026-08-19T12:00:00Z') }));
    expect(kinds(out)).not.toContain('sin_capturas');
  });
});

describe('buildInsights — encouragement', () => {
  it('only celebrates a real streak', () => {
    expect(kinds(buildInsights(input({ recentCount: 4 })))).not.toContain('aliento');
    expect(kinds(buildInsights(input({ recentCount: 5 })))).toContain('aliento');
  });

  it('does not claim the filing is up to date, only that the documents are in', () => {
    const out = buildInsights(input({ recentCount: 4, recentDocs: 5 }));
    const card = out.find((i) => i.kind === 'aliento')!;
    expect(card.title).not.toMatch(/al día/i);
    // 4 facturas computables and 1 nota de remisión, said apart.
    expect(card.body).toContain('5 documento(s)');
    expect(card.body).toContain('4 computables');
    expect(card.body).toMatch(/Importar no es declarar/);
  });
});

describe('projectIva', () => {
  it('extrapolates the month at the current pace', () => {
    // 10 days in, 100k of IVA → ~310k over a 31-day month.
    const r = projectIva([{ month: '2026-08', count: 4, total: 0, iva: 100_000 }], new Date('2026-08-10T00:00:00Z'));
    expect(r.soFar).toBe(100_000);
    expect(Math.round(r.projected)).toBe(310_000);
  });

  it('returns zero when the current month has nothing', () => {
    const r = projectIva([{ month: '2026-07', count: 9, total: 0, iva: 500_000 }], NOW);
    expect(r.soFar).toBe(0);
    expect(r.projected).toBe(0);
  });
});
