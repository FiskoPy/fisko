import { describe, expect, it } from 'vitest';

import { documentSign } from '../src/modules/reports/reports.service';
import { dteBelongsTo } from '../src/modules/invoices/invoices.service';

describe('documentSign — how each SIFEN document counts', () => {
  it('adds invoices, autofacturas and debit notes', () => {
    for (const t of [1, 2, 3, 4, 6]) expect(documentSign(t)).toBe(1);
  });
  it('subtracts credit notes: a refund must reduce compras and IVA crédito', () => {
    expect(documentSign(5)).toBe(-1);
  });
  it('leaves out remisiones and retenciones, which are not operations', () => {
    expect(documentSign(7)).toBe(0);
    expect(documentSign(8)).toBe(0);
  });
});

describe('dteBelongsTo — the mailbox filter', () => {
  const mine = '80175384';
  it('accepts a DTE where the user is the receptor (a purchase)', () => {
    expect(dteBelongsTo({ emisorRuc: '80054993', receptorRuc: '80175384' }, mine)).toBe(true);
  });
  it('accepts a DTE where the user is the emisor (a sale)', () => {
    expect(dteBelongsTo({ emisorRuc: '80175384', receptorRuc: '1234567' }, mine)).toBe(true);
  });
  it('rejects a DTE between two other taxpayers', () => {
    expect(dteBelongsTo({ emisorRuc: '80054993', receptorRuc: '1234567' }, mine)).toBe(false);
  });
  it('ignores formatting differences (dv, hyphen, spaces)', () => {
    expect(dteBelongsTo({ emisorRuc: '1', receptorRuc: '80175384-8' }, '80175384')).toBe(true);
  });
  it('never filters when the user has no RUC on file', () => {
    expect(dteBelongsTo({ emisorRuc: '1', receptorRuc: '2' }, '')).toBe(true);
  });
});
