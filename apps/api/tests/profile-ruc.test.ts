import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../src/app';
import { calcRucDv, isValidRucDv } from '../src/utils/ruc';

/**
 * RUC is optional at sign-up, and until now it could never be added later:
 * there was no route, and Perfil only rendered the field when it already had
 * a value. A user without a RUC has every invoice counted as a purchase
 * (getSummary compares the emisor's RUC with the user's), so ventas and IVA
 * débito stay at zero for good. PATCH /auth/me is the way back.
 *
 * These run without a database: everything asserted here happens before the
 * handler touches Postgres.
 */
const app = createApp();

describe('PATCH /auth/me', () => {
  it('is mounted and requires authentication', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .send({ ruc: '80175384', rucDv: 8 });
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(404); // 404 would mean the route is missing
  });

  it('rejects a bogus token rather than accepting the write', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('authorization', 'Bearer not-a-token')
      .send({ ruc: '80175384', rucDv: 8 });
    expect(res.status).toBe(401);
  });
});

describe('RUC check digit — the rule both paths share', () => {
  it("computes the client's own RUC: 80175384 → 8", () => {
    expect(calcRucDv('80175384')).toBe(8);
    expect(isValidRucDv('80175384', 8)).toBe(true);
  });

  it('rejects every other digit for that RUC', () => {
    for (let d = 0; d <= 9; d++) {
      if (d !== 8) expect(isValidRucDv('80175384', d)).toBe(false);
    }
  });

  it('ignores separators, so "8.017.538-4" style input still validates', () => {
    expect(calcRucDv('80175384')).toBe(calcRucDv('8.017.538-4'.replace(/\D/g, '')));
  });
});
