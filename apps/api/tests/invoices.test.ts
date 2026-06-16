import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { DTE_XML, REAL_CDC } from './fixtures/dte';

/**
 * Integration tests for the invoices module (Marco 2A). Requires Postgres.
 */
const app = createApp();
const base = '/api/v1';
const stamp = process.hrtime.bigint().toString();
const email = `inv_${stamp}@example.com`;
let token = '';

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { contains: '@example.com' } } });
}

beforeAll(async () => {
  await cleanup();
  const reg = await request(app)
    .post(`${base}/auth/register`)
    .send({ name: 'Inv User', email, password: 'Passw0rd!1' });
  token = reg.body.tokens.accessToken;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('POST /invoices/import-xml', () => {
  it('requires auth', async () => {
    const res = await request(app).post(`${base}/invoices/import-xml`).send({ xml: DTE_XML });
    expect(res.status).toBe(401);
  });

  it('imports a DTE and stores parsed fields + items', async () => {
    const res = await request(app)
      .post(`${base}/invoices/import-xml`)
      .set('Authorization', `Bearer ${token}`)
      .send({ xml: DTE_XML });
    expect(res.status).toBe(201);
    const inv = res.body.invoice;
    expect(inv.cdc).toBe(REAL_CDC);
    expect(inv.emisorNombre).toBe('VIELA S.A.');
    expect(inv.totalOpe).toBe(237500);
    expect(inv.iva10).toBeCloseTo(18545.45, 2);
    expect(inv.iva5).toBeCloseTo(1595.24, 2);
    expect(inv.items).toHaveLength(3);
  });

  it('rejects a duplicate import (same CDC) with 409', async () => {
    const res = await request(app)
      .post(`${base}/invoices/import-xml`)
      .set('Authorization', `Bearer ${token}`)
      .send({ xml: DTE_XML });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects invalid XML with 400', async () => {
    const res = await request(app)
      .post(`${base}/invoices/import-xml`)
      .set('Authorization', `Bearer ${token}`)
      .send({ xml: '<root><nope/></root>' });
    expect(res.status).toBe(400);
  });
});

describe('GET /invoices + detail + delete', () => {
  it('lists the user invoices', async () => {
    const res = await request(app)
      .get(`${base}/invoices`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].cdc).toBe(REAL_CDC);
  });

  it('returns the detail with items, then deletes it', async () => {
    const list = await request(app)
      .get(`${base}/invoices`)
      .set('Authorization', `Bearer ${token}`);
    const id = list.body.items[0].id;

    const detail = await request(app)
      .get(`${base}/invoices/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.invoice.items).toHaveLength(3);

    const del = await request(app)
      .delete(`${base}/invoices/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const after = await request(app)
      .get(`${base}/invoices`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.total).toBe(0);
  });
});
