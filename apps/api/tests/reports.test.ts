import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { DTE_XML } from './fixtures/dte';

const app = createApp();
const base = '/api/v1';
const stamp = process.hrtime.bigint().toString();
const email = `rep_${stamp}@example.com`;
let token = '';

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { contains: '@example.com' } } });
}

beforeAll(async () => {
  await cleanup();
  const reg = await request(app)
    .post(`${base}/auth/register`)
    .send({ name: 'Rep User', email, password: 'Passw0rd!1' });
  token = reg.body.tokens.accessToken;
  await request(app)
    .post(`${base}/invoices/import-xml`)
    .set('Authorization', `Bearer ${token}`)
    .send({ xml: DTE_XML });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('GET /reports/summary', () => {
  it('aggregates the imported invoices (IVA 5/10 + totals + byMonth)', async () => {
    const res = await request(app)
      .get(`${base}/reports/summary`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.totalOpe).toBe(237500);
    expect(res.body.iva10).toBeCloseTo(18545.45, 2);
    expect(res.body.iva5).toBeCloseTo(1595.24, 2);
    expect(res.body.totalIva).toBeCloseTo(20140.69, 2);
    expect(res.body.byMonth).toHaveLength(1);
    expect(res.body.byMonth[0].month).toBe('2026-02');
    expect(typeof res.body.irpEstimado).toBe('number');
  });

  it('requires auth', async () => {
    const res = await request(app).get(`${base}/reports/summary`);
    expect(res.status).toBe(401);
  });
});

describe('GET /reports/export', () => {
  it('returns a PDF', async () => {
    const res = await request(app)
      .get(`${base}/reports/export?format=pdf`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(500);
  });

  it('returns an Excel file', async () => {
    const res = await request(app)
      .get(`${base}/reports/export?format=excel`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(500);
  });
});
