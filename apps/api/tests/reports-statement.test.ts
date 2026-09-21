import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { getSummary, rentaRegimenOf } from '../src/modules/reports/reports.service';

/**
 * The IVA as it is declared, not as a pile of totals: what was credited, what
 * was owed, what an earlier period left in the taxpayer's favour, what he
 * actually pays, and what carries on. Plus which income tax he estimates —
 * a company files IRE, and the report was offering an E.A.S. an IRP figure.
 *
 * Requires Postgres.
 */

const app = createApp();
const base = '/api/v1';
const stamp = `stm_${process.hrtime.bigint()}`;
let token = '';
let userId = '';

/** One purchase invoice, in guaraníes, issued on [fecha]. */
async function compra(fecha: string, total: number, iva: number, over: Record<string, unknown> = {}) {
  return prisma.invoice.create({
    data: {
      userId,
      cdc: `${stamp}_${fecha}_${total}`.slice(0, 44).padEnd(44, '0'),
      tipoDoc: 1,
      emisorRuc: '80054993',
      emisorDv: 7,
      emisorNombre: 'PROVEEDOR S.A.',
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
      ...over,
    },
  });
}

beforeAll(async () => {
  const reg = await request(app)
    .post(`${base}/auth/register`)
    .send({ name: 'TecBio E.A.S.', email: `${stamp}@example.com`, password: 'Passw0rd!1' });
  token = reg.body.tokens.accessToken;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: `${stamp}@example.com` } })).id;
  await prisma.user.update({ where: { id: userId }, data: { ruc: '80175384', rucDv: 8 } });

  // July: 500.000 of IVA crédito. August: 300.000 more. No sales at all —
  // which is the client's own shape, and the one that must not read as debt.
  await compra('2026-07-10', 5_500_000, 500_000);
  await compra('2026-08-12', 3_300_000, 300_000);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
  await prisma.$disconnect();
});

const month = (m: string) => ({
  from: new Date(`${m}-01T00:00:00.000Z`),
  to: new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)),
});

describe('the IVA statement of a period', () => {
  it('carries the credit of earlier periods into this one', async () => {
    const s = await getSummary(userId, month('2026-08'));
    expect(s.ivaCredito).toBe(300_000);
    expect(s.ivaDebito).toBe(0);
    expect(s.saldoAnterior).toBe(500_000); // July's credit
    expect(s.ivaAPagar).toBe(0);
    expect(s.saldoSiguiente).toBe(800_000);
  });

  it('starts from zero on the first period', async () => {
    const s = await getSummary(userId, month('2026-07'));
    expect(s.saldoAnterior).toBe(0);
    expect(s.saldoSiguiente).toBe(500_000);
    expect(s.ivaAPagar).toBe(0);
  });

  it('pays only what the credit and the previous balance do not cover', async () => {
    // A sale in September: débito 1.000.000 against 800.000 carried in.
    await compra('2026-09-05', 11_000_000, 1_000_000, {
      cdc: `${stamp}_venta`.slice(0, 44).padEnd(44, '1'),
      emisorRuc: '80175384', // the user is the issuer: this is a sale
      emisorDv: 8,
    });
    const s = await getSummary(userId, month('2026-09'));
    expect(s.ivaDebito).toBe(1_000_000);
    expect(s.saldoAnterior).toBe(800_000);
    expect(s.ivaAPagar).toBe(200_000);
    expect(s.saldoSiguiente).toBe(0);
  });
});

describe('which income tax is estimated', () => {
  it('reads a company from the profile, and falls back to the RUC', () => {
    expect(rentaRegimenOf({ tipoContribuyente: 'juridica', ruc: '4904579' })).toBe('IRE');
    expect(rentaRegimenOf({ tipoContribuyente: 'fisica', ruc: '80175384' })).toBe('IRP');
    // TecBio: an E.A.S., eight digits starting with 8.
    expect(rentaRegimenOf({ ruc: '80175384' })).toBe('IRE');
    // A person files with their CI.
    expect(rentaRegimenOf({ ruc: '4904579' })).toBe('IRP');
    expect(rentaRegimenOf({})).toBe('IRP');
  });

  it('names IRE in the summary of a company', async () => {
    const s = await getSummary(userId, {});
    expect(s.rentaRegimen).toBe('IRE');
  });
});

describe('sales and purchases are two ledgers, not one total', () => {
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('lists one side at a time, by the RUC on the invoice', async () => {
    const ventas = await request(app).get(`${base}/invoices?tipo=venta`).set(auth());
    const compras = await request(app).get(`${base}/invoices?tipo=compra`).set(auth());

    expect(ventas.status).toBe(200);
    // The taxpayer issued one of these (emisorRuc 80175384, his own).
    expect(ventas.body.items.every((i: { tipo: string }) => i.tipo === 'venta')).toBe(true);
    expect(ventas.body.items.length).toBeGreaterThan(0);
    expect(compras.body.items.every((i: { tipo: string }) => i.tipo === 'compra')).toBe(true);
    expect(compras.body.items.length).toBeGreaterThan(0);
    // Between them they are the whole list.
    const all = await request(app).get(`${base}/invoices?pageSize=100`).set(auth());
    expect(ventas.body.total + compras.body.total).toBe(all.body.total);
  });

  it('moves the IVA from crédito to débito when the side is corrected', async () => {
    const compra = await prisma.invoice.findFirstOrThrow({
      where: { userId, emisorRuc: '80054993', fechaEmision: new Date('2026-07-10T00:00:00.000Z') },
    });
    const before = await getSummary(userId, month('2026-07'));
    expect(before.ivaCredito).toBe(500_000);
    expect(before.ivaDebito).toBe(0);

    const res = await request(app)
      .patch(`${base}/invoices/${compra.id}/tipo`)
      .set(auth())
      .send({ tipo: 'venta' });
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ tipo: 'venta', tipoManual: true });

    const after = await getSummary(userId, month('2026-07'));
    expect(after.ivaDebito).toBe(500_000);
    expect(after.ivaCredito).toBe(0);
    // And the carry into August follows it: nothing left over to carry.
    expect((await getSummary(userId, month('2026-08'))).saldoAnterior).toBe(0);

    // Back under the RUC.
    await request(app).patch(`${base}/invoices/${compra.id}/tipo`).set(auth()).send({ tipo: null });
    const back = await getSummary(userId, month('2026-07'));
    expect(back.ivaCredito).toBe(500_000);
  });
});

describe('correcting a category by hand', () => {
  it('files the invoice where the user says, and keeps it there', async () => {
    const invoice = await compra('2026-08-20', 1_100_000, 100_000, {
      cdc: `${stamp}_cat`.slice(0, 44).padEnd(44, '2'),
      emisorNombre: 'DISTRIBUIDORA DEL ESTE S.A.',
    });

    const before = await request(app)
      .get(`${base}/invoices/${invoice.id}`)
      .set({ Authorization: `Bearer ${token}` });
    expect(before.body.invoice.categoria).toBe('otros');
    expect(before.body.invoice.categoriaManual).toBe(false);

    const res = await request(app)
      .patch(`${base}/invoices/${invoice.id}/categoria`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ categoria: 'insumos_agricolas' });

    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({
      categoria: 'insumos_agricolas',
      categoriaLabel: 'Insumos agrícolas',
      categoriaManual: true,
    });

    const s = await getSummary(userId, month('2026-08'));
    expect(s.byCategory.find((c) => c.key === 'insumos_agricolas')?.total).toBe(1_100_000);
  });

  it('refuses a category that does not exist, and takes null to go back to the rules', async () => {
    const invoice = await compra('2026-08-21', 550_000, 50_000, {
      cdc: `${stamp}_cat2`.slice(0, 44).padEnd(44, '3'),
    });
    const auth = { Authorization: `Bearer ${token}` };

    const bad = await request(app)
      .patch(`${base}/invoices/${invoice.id}/categoria`)
      .set(auth)
      .send({ categoria: 'criptomonedas' });
    expect(bad.status).toBe(400);

    await request(app)
      .patch(`${base}/invoices/${invoice.id}/categoria`)
      .set(auth)
      .send({ categoria: 'salud' });
    const back = await request(app)
      .patch(`${base}/invoices/${invoice.id}/categoria`)
      .set(auth)
      .send({ categoria: null });
    expect(back.body.invoice.categoriaManual).toBe(false);
  });
});
