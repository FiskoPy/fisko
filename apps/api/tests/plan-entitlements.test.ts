import { describe, expect, it } from 'vitest';

import { PLANS, getPlan, resolveActive, type SubscriptionRow } from '../src/services/plans';

/**
 * The daily OCR figure in the catalogue is a promise to the customer and a cap
 * on the client's Vision bill at the same time. Before this, every tier got a
 * flat 30/day: a free user could burn ten times what the free tier offers.
 */

const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const row = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  planId: 'pro',
  status: 'active',
  currentPeriodEnd: inDays(10),
  ...over,
});

describe('resolveActive', () => {
  it('gives the free plan when there is no subscription at all', () => {
    const { plan, active } = resolveActive(null);
    expect(plan.id).toBe('gratis');
    expect(active).toBe(false);
  });

  it('gives the paid plan while the period is still running', () => {
    const { plan, active } = resolveActive(row());
    expect(plan.id).toBe('pro');
    expect(active).toBe(true);
  });

  it('drops to free the moment the period ends', () => {
    const { plan, active } = resolveActive(row({ currentPeriodEnd: inDays(-1) }));
    expect(plan.id).toBe('gratis');
    expect(active).toBe(false);
  });

  it('does not honour a pending payment', () => {
    expect(resolveActive(row({ status: 'pending' })).plan.id).toBe('gratis');
  });

  it('treats a missing period end as not entitled', () => {
    expect(resolveActive(row({ currentPeriodEnd: null })).plan.id).toBe('gratis');
  });

  it('falls back to free if the row names a plan we no longer sell', () => {
    expect(resolveActive(row({ planId: 'plan-viejo' })).plan.id).toBe('gratis');
  });
});

describe('ocrPerDay — the cap that maps to the Vision bill', () => {
  it('never lets a cheaper tier get more photos than a dearer one', () => {
    const order = ['gratis', 'basico', 'pro', 'empresarial'];
    const perDay = order.map((id) => getPlan(id)!.ocrPerDay);
    for (let i = 1; i < perDay.length; i++) {
      expect(perDay[i]).toBeGreaterThan(perDay[i - 1]!);
    }
  });

  it('gives every plan a positive, finite daily cap', () => {
    for (const p of PLANS) {
      expect(Number.isInteger(p.ocrPerDay)).toBe(true);
      expect(p.ocrPerDay).toBeGreaterThan(0);
    }
  });

  it('caps the free tier tightly: it is unpaid Vision usage', () => {
    expect(getPlan('gratis')!.ocrPerDay).toBeLessThanOrEqual(5);
  });
});
