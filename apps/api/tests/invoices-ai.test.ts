import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Both readers are paid network calls; here each photo's reading is fixed.
vi.mock('../src/services/ocr', () => ({
  MAX_IMAGE_BYTES: 6 * 1024 * 1024,
  isOcrConfigured: () => true,
  extractText: vi.fn(),
}));
vi.mock('../src/services/ai-reader', () => ({
  isAiReaderEnabled: () => true,
  readInvoiceWithAI: vi.fn(),
}));

import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { readInvoiceWithAI } from '../src/services/ai-reader';
import { extractText } from '../src/services/ocr';
import { layoutsOf } from '../src/services/vision-layout';
import { aiFixture, type AiFixture } from './fixtures/ai';
import { visionFixture, type VisionFixture } from './fixtures/vision';
import type { Extraction } from '../src/services/receipt-parser';

/**
 * Importing a photo, end to end, with both readers on it: what is stored,
 * with which numbers, and what is refused instead.
 *
 * The photos are the client's own — the dollar invoice that was stored as
 * Gs 1.538 among them. Requires Postgres. Each group registers its own user:
 * the free plan allows three photos a day.
 */

const app = createApp();
const base = '/api/v1';
const stamp = `ai_${process.hrtime.bigint()}`;
const photo = { imageBase64: 'A'.repeat(200) };
let users = 0;
let token = '';
let userId = '';

/** A fresh user — the free plan allows three photos a day — with their RUC. */
async function newUser(ruc?: string) {
  const email = `${stamp}_${++users}@example.com`;
  const reg = await request(app)
    .post(`${base}/auth/register`)
    .send({ name: 'AI User', email, password: 'Passw0rd!1' });
  token = reg.body.tokens.accessToken;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  // The buyer's own RUC tells the readers which party is the issuer.
  if (ruc) await prisma.user.update({ where: { id: userId }, data: { ruc } });
}

/** The next photo is Vision's real output for this fixture, read by the model like this. */
function reads(name: VisionFixture, ai: Extraction | null) {
  const annotation = visionFixture(name);
  vi.mocked(extractText).mockResolvedValueOnce({
    text: annotation.text ?? '',
    layouts: layoutsOf(annotation),
  });
  vi.mocked(readInvoiceWithAI).mockResolvedValueOnce(ai);
}

/** The next photo reads as this text — a layout with no fixture of its own. */
function readsText(text: string, ai: Extraction | null) {
  vi.mocked(extractText).mockResolvedValueOnce({ text, layouts: [{ layout: 'blocks', text }] });
  vi.mocked(readInvoiceWithAI).mockResolvedValueOnce(ai);
}

const model = (name: AiFixture, overrides: Partial<Extraction> = {}): Extraction => ({
  ...aiFixture(name),
  ...overrides,
});

const post = () =>
  request(app)
    .post(`${base}/invoices/import-photo`)
    .set({ Authorization: `Bearer ${token}` })
    .send(photo);

const storedInvoice = async () =>
  prisma.invoice.findFirstOrThrow({ where: { userId }, include: { items: true } });

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
  await prisma.$disconnect();
});

describe('a dollar invoice', () => {
  it('is refused when only the parser reads it — it has no exchange rate', async () => {
    await newUser('80175384');
    reads('rrtop-usd-kude', null);

    const res = await post();

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('dólares');
    expect(await prisma.invoice.count({ where: { userId } })).toBe(0);
  });

  it('is stored in dollars, with the rate and the items the model read', async () => {
    reads('rrtop-usd-kude', model('usd-rrtop'));

    const res = await post();

    expect(res.status).toBe(201);
    // The app shows "USD 1.538,00 ≈ Gs 9.270.941 · cambio 6.027,92", so the
    // rate has to travel with the invoice — the client asked what rate each
    // dollar invoice went in at (2026-09-20).
    expect(res.body.invoice).toMatchObject({ moneda: 'USD', tipoCambio: 6_027.92 });
    const invoice = await storedInvoice();
    expect({
      moneda: invoice.moneda,
      tipoCambio: Number(invoice.tipoCambio),
      total: Number(invoice.totalOpe),
      iva10: Number(invoice.iva10),
      baseGrav10: Number(invoice.baseGrav10),
      emisorRuc: invoice.emisorRuc,
      emisorNombre: invoice.emisorNombre,
      fecha: invoice.fechaEmision.toISOString().slice(0, 10),
    }).toEqual({
      moneda: 'USD',
      tipoCambio: 6_027.92,
      total: 1_538,
      iva10: 139.82,
      // 1.398,18 + 139,82 = 1.538,00 exactly. The IVA is printed on the paper
      // and stands; the base, worked out from it, carries the rounding — at
      // 1.398,20 the parts came to 1.538,02 and the month's report stood
      // 120 Gs above the sum of its own invoices (2026-09-20).
      baseGrav10: 1_398.18,
      emisorRuc: '80156877',
      emisorNombre: 'RR TOP AGRO E.A.S.',
      fecha: '2026-08-18',
    });
    // What the declaration is read by: base + IVA + exentas = total, exactly.
    const parts =
      Number(invoice.baseGrav5) +
      Number(invoice.iva5) +
      Number(invoice.baseGrav10) +
      Number(invoice.iva10) +
      Number(invoice.exentas);
    expect(parts).toBe(Number(invoice.totalOpe));

    expect(invoice.items).toHaveLength(3);
    const first = invoice.items.find((i) => i.descripcion.startsWith('ACRUX'));
    expect({
      cantidad: Number(first?.cantidad),
      precioUnit: Number(first?.precioUnit),
      total: Number(first?.total),
      ivaMonto: Number(first?.ivaMonto),
      ivaBase: Number(first?.ivaBase),
    }).toEqual({ cantidad: 120, precioUnit: 4.9, total: 588, ivaMonto: 53.45, ivaBase: 534.55 });
  });

  it('is refused when the model reads the same amounts as guaraníes', async () => {
    reads('rrtop-usd-kude', model('usd-rrtop', { moneda: 'PYG', tipoCambio: null, totalEnGuaranies: null }));

    const res = await post();

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('dólares');
    expect(await prisma.invoice.count({ where: { userId } })).toBe(1);
  });
});

describe('a guaraní ticket', () => {
  it('is stored with the items only the model reads', async () => {
    await newUser();
    reads('minas281-ticket', model('minas281'));

    const res = await post();

    expect(res.status).toBe(201);
    expect(res.body.missing).toEqual([]);
    const invoice = await storedInvoice();
    expect({
      moneda: invoice.moneda,
      tipoCambio: invoice.tipoCambio,
      total: Number(invoice.totalOpe),
      iva5: Number(invoice.iva5),
      iva10: Number(invoice.iva10),
      emisorNombre: invoice.emisorNombre,
    }).toEqual({
      moneda: 'PYG',
      tipoCambio: null,
      total: 91_925,
      iva5: 2_115,
      iva10: 4_318,
      emisorNombre: 'MINAS281 MERCADO',
    });
    expect(invoice.items).toHaveLength(5);
    expect(invoice.items.reduce((s, i) => s + Number(i.total), 0)).toBe(91_925);
  });

  it('is refused when the two readings hold up but say different amounts', async () => {
    reads(
      'minas281-ticket',
      model('minas281', { total: 91_000, gravada10: 46_575, iva10: 4_234, totalIva: 6_349 }),
    );

    const res = await post();

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('no coinciden');
    expect(await prisma.invoice.count({ where: { userId } })).toBe(1);
  });
});

describe('a layout the parser cannot read', () => {
  // Every figure of the invoice is in the text; no label the parser knows.
  const TEXT = ['VIELA S.A.', 'RUC 80054993-7', '005-005-0141150', '14/02/2026', '33.500 204.000', '18.545', '237.500'].join('\n');
  const answer = (overrides: Partial<Extraction> = {}): Extraction =>
    model('minas281', {
      emisorNombre: 'VIELA S.A.',
      emisorRuc: '80054993',
      emisorDv: 7,
      timbrado: null,
      numeroDoc: '005-005-0141150',
      fecha: '2026-02-14',
      total: 237_500,
      gravada5: 0,
      iva5: 0,
      gravada10: 204_000,
      iva10: 18_545,
      exentas: 33_500,
      totalIva: 18_545,
      items: [],
      ...overrides,
    });

  it('is stored from the model, once Vision has seen its numbers', async () => {
    await newUser();
    readsText(TEXT, answer());

    const res = await post();

    expect(res.status).toBe(201);
    const invoice = await storedInvoice();
    expect({
      total: Number(invoice.totalOpe),
      iva10: Number(invoice.iva10),
      emisorRuc: invoice.emisorRuc,
      numeroDoc: invoice.numeroDoc,
    }).toEqual({ total: 237_500, iva10: 18_545, emisorRuc: '80054993', numeroDoc: '005-005-0141150' });
  });

  it('stores guaraníes whole, even where the model read cents', async () => {
    // A guaraní has no cents, and iva5/iva10 are tax columns.
    const other = ['VIELA S.A.', 'RUC 80054993-7', '005-005-0141151', '15/02/2026', '33.500 204.000', '18.545,40', '237.500'];
    readsText(
      other.join('\n'),
      answer({ numeroDoc: '005-005-0141151', fecha: '2026-02-15', iva10: 18_545.4, totalIva: 18_545.4 }),
    );

    const res = await post();

    expect(res.status).toBe(201);
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { userId, numeroDoc: '005-005-0141151' },
    });
    expect(Number(invoice.iva10)).toBe(18_545);
    expect(Number(invoice.totalIva)).toBe(18_545);
  });

  it('is refused when the model reads amounts that are not in the text', async () => {
    readsText(TEXT, answer({ total: 240_000, gravada10: 206_500, iva10: 18_773, exentas: 33_500, totalIva: 18_773 }));

    const res = await post();

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('total');
    expect(await prisma.invoice.count({ where: { userId } })).toBe(2);
  });
});
