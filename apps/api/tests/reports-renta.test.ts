import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { getSummary } from '../src/modules/reports/reports.service';

/**
 * The income tax estimate is the fiscal year's, on figures without IVA: the
 * IRE General is annual and on net income (the client's Constancia de RUC:
 * "IRE GENERAL", ejercicio closing in December). It used to be 10% of one
 * period's totals WITH IVA.
 *
 * Requires Postgres.
 */

const app = createApp();
const stamp = `renta_${process.hrtime.bigint()}`;
let userId = '';

async function invoice(fecha: string, total: number, iva: number, emisorRuc: string) {
  return prisma.invoice.create({
    data: {
      userId,
      cdc: `${stamp}_${fecha}_${total}_${emisorRuc}`.slice(0, 44).padEnd(44, '0'),
      tipoDoc: 1,
      emisorRuc,
      emisorDv: 0,
      emisorNombre: 'X',
      fechaEmision: new Date(`${fecha}T00:00:00.000Z`),
      moneda: 'PYG',
      totalOpe: total,
      totalIva: iva,
      iva5: 0,
      iva10: iva,
      baseGrav5: 0,
      baseGrav10: total - iva,
      exentas: 0,
      source: 'manual',
    },
  });
}

beforeAll(async () => {
  await request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Renta EAS', email: `${stamp}@example.com`, password: 'Passw0rd!1' });
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: `${stamp}@example.com` } })).id;
  await prisma.user.update({ where: { id: userId }, data: { ruc: '80175384', rucDv: 8 } });

  await invoice('2025-12-15', 110_000_000, 10_000_000, '80175384'); // last year: not this ejercicio
  await invoice('2026-08-10', 22_000_000, 2_000_000, '80175384'); // sale, base 20M
  await invoice('2026-08-20', 11_000_000, 1_000_000, '80054993'); // purchase, base 10M
  await invoice('2026-09-05', 5_500_000, 500_000, '80175384'); // sale, base 5M
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
  await prisma.$disconnect();
});

describe('the income tax estimate', () => {
  it('takes the whole ejercicio up to the period, without IVA', async () => {
    const s = await getSummary(userId, {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-30T00:00:00.000Z'),
    });
    expect(s.rentaRegimen).toBe('IRE');
    expect(s.rentaDesde).toBe('2026-08-10');
    expect(s.rentaHasta).toBe('2026-09-30');
    expect(s.rentaIngresos).toBe(25_000_000);
    expect(s.rentaEgresos).toBe(10_000_000);
    expect(s.rentaEstimado).toBe(1_500_000);
    // September alone, with IVA, would have said 10% of 5,5M.
    expect(s.ventas).toBe(5_500_000);
  });

  it('stops at the end of the period asked for', async () => {
    const s = await getSummary(userId, {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-31T00:00:00.000Z'),
    });
    expect(s.rentaIngresos).toBe(20_000_000);
    expect(s.rentaEstimado).toBe(1_000_000);
  });
});
