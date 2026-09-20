import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Vision is a paid network call; each photo's text is fixed here instead.
vi.mock('../src/services/ocr', () => ({
  MAX_IMAGE_BYTES: 6 * 1024 * 1024,
  isOcrConfigured: () => true,
  extractText: vi.fn(),
}));

import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { importXml } from '../src/modules/invoices/invoices.service';
import { extractText } from '../src/services/ocr';
import { DTE_XML, REAL_CDC } from './fixtures/dte';

/**
 * A KuDE is the printed copy of an electronic invoice, and people photograph
 * it — the same invoice whose XML the mailbox sync imports. Keyed apart, the
 * two landed as separate invoices and the IVA counted twice. The photo is now
 * keyed by the CDC printed on it, or recognised by its issuer and document
 * number when the CDC is out of frame, and the XML — the document itself,
 * with its items — replaces it.
 *
 * Also here: the photos importPhoto must refuse rather than store. Requires
 * Postgres. Each group registers its own user: the free plan allows three
 * photos a day, and every group sends three.
 */

const lines = (...l: string[]) => l.join('\n');

/** The invoice in DTE_XML, as a photo of its KuDE reads. */
const HEADER = [
  'KuDE - Factura Electrónica',
  'VIELA S.A.',
  'RUC: 80054993-7',
  'Timbrado: 12345678',
  'Factura Electrónica: 005-005-0141150',
  'Fecha de emisión: 14/02/2026',
];
const FOOTER = [
  'Total Pago. Gs 237.500',
  'Gravadas 5%: Gs 33.500',
  'Gravadas 10%: Gs 204.000',
  'IVA 5%: Gs 1.595',
  'IVA 10%: Gs 18.545',
];
const KUDE = lines(...HEADER, ...FOOTER, REAL_CDC);
/** The same KuDE, photographed with its CDC out of frame. */
const KUDE_NO_CDC = lines(...HEADER, ...FOOTER);

const app = createApp();
const base = '/api/v1';
const stamp = `kude_${process.hrtime.bigint()}`;
const photo = { imageBase64: 'A'.repeat(200) };
let users = 0;
let token = '';
let userId = '';

/** A fresh user, with a fresh daily photo allowance. */
async function newUser() {
  const email = `${stamp}_${++users}@example.com`;
  const reg = await request(app)
    .post(`${base}/auth/register`)
    .send({ name: 'KuDE User', email, password: 'Passw0rd!1' });
  token = reg.body.tokens.accessToken;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
}

/** The next photo sent reads as this text. */
const photoReads = (text: string) =>
  vi.mocked(extractText).mockResolvedValueOnce({ text, layouts: [{ layout: 'blocks', text }] });
const auth = () => ({ Authorization: `Bearer ${token}` });
const postPhoto = () => request(app).post(`${base}/invoices/import-photo`).set(auth()).send(photo);
const postXml = () => request(app).post(`${base}/invoices/import-xml`).set(auth()).send({ xml: DTE_XML });
const stored = () => prisma.invoice.findMany({ where: { userId }, select: { cdc: true, source: true } });

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
  await prisma.$disconnect();
});

describe('a photographed KuDE, then the XML of the same invoice', () => {
  beforeAll(newUser);

  it('stores the photo under the CDC printed on it', async () => {
    photoReads(KUDE);
    const res = await postPhoto();
    expect(res.status).toBe(201);
    expect(res.body.invoice.cdc).toBe(REAL_CDC);
    expect(res.body.invoice.source).toBe('ocr');
    expect(res.body.invoice.tipoDocDesc).toBe('Factura electrónica (foto)');
    expect(res.body.invoice.totalOpe).toBe(237_500);
    expect(res.body.missing).toEqual([]);
  });

  it('turns away a second photo of it', async () => {
    photoReads(KUDE);
    expect((await postPhoto()).status).toBe(409);
  });

  it('lets the XML replace the photo reading, items and all', async () => {
    const res = await postXml();
    expect(res.status).toBe(201);
    expect(res.body.invoice.source).toBe('manual');
    expect(res.body.invoice.items).toHaveLength(3);
    expect(await stored()).toEqual([{ cdc: REAL_CDC, source: 'manual' }]);
  });

  it('then turns away a second XML of it', async () => {
    expect((await postXml()).status).toBe(409);
  });

  it('and a later photo of it, so the invoice is never counted twice', async () => {
    photoReads(KUDE);
    expect((await postPhoto()).status).toBe(409);
    expect(await stored()).toEqual([{ cdc: REAL_CDC, source: 'manual' }]);
  });
});

describe('the same XML by mailbox, then by hand', () => {
  beforeAll(newUser);

  it('takes it once from the mailbox', async () => {
    const invoice = await importXml(userId, DTE_XML, 'email');
    expect(invoice.cdc).toBe(REAL_CDC);
    expect(invoice.source).toBe('email');
  });

  it('turns away the same XML imported by hand — the CDC is the same invoice', async () => {
    // The client asked what happens when a supplier's XML arrives by email and
    // he also loads it himself (2026-09-20). Counting it twice would double
    // its IVA crédito.
    const res = await postXml();
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ya fue importada/i);
    expect(await stored()).toEqual([{ cdc: REAL_CDC, source: 'email' }]);
  });
});

describe('the same KuDE photographed with its CDC out of frame', () => {
  beforeAll(newUser);

  it('is stored under a paper key', async () => {
    photoReads(KUDE_NO_CDC);
    const res = await postPhoto();
    expect(res.status).toBe(201);
    expect(res.body.invoice.cdc).toMatch(/^OCR:/);
  });

  it('is recognised in a retake that reads the total differently', async () => {
    // Same issuer, same document number: the same invoice, whatever its total.
    photoReads(
      lines(
        ...HEADER,
        'Total Pago. Gs 237.600',
        'Gravadas 5%: Gs 33.600',
        'Gravadas 10%: Gs 204.000',
        'IVA 5%: Gs 1.600',
        'IVA 10%: Gs 18.545',
      ),
    );
    const res = await postPhoto();
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/borrala/);
  });

  it('is found and replaced by the XML, by its issuer and number', async () => {
    expect((await postXml()).status).toBe(201);
    expect(await stored()).toEqual([{ cdc: REAL_CDC, source: 'manual' }]);
  });

  it('is not taken again from a photo once the XML is in', async () => {
    // The XML stores no printed number, but its CDC encodes it.
    photoReads(KUDE_NO_CDC);
    expect((await postPhoto()).status).toBe(409);
  });
});

describe('photos that are refused rather than stored', () => {
  beforeAll(newUser);

  it('refuses amounts that contradict each other', async () => {
    photoReads(
      lines(
        ...HEADER,
        'Total Pago. Gs 29',
        'Gravadas 5%: Gs 33.500',
        'Gravadas 10%: Gs 204.000',
        'IVA 5%: Gs 1.595',
        'IVA 10%: Gs 18.545',
      ),
    );
    const res = await postPhoto();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no cuadran/);
  });

  it('refuses a photo whose IVA could not be read', async () => {
    photoReads(lines(...HEADER, 'Total Pago. Gs 237.500'));
    const res = await postPhoto();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/IVA/);
  });

  it('refuses a credit note, which a photo would store as a purchase', async () => {
    photoReads(lines('KuDE de Nota de Crédito Electrónica', ...HEADER.slice(1), ...FOOTER));
    const res = await postPhoto();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/notas de crédito/);
  });

  it('stored none of them', async () => {
    expect(await stored()).toEqual([]);
  });
});

/**
 * Another invoice from the same issuer that reuses the number — a new
 * timbrado restarts the count — on another date, for another amount.
 */
const OTHER = lines(
  'KuDE - Factura Electrónica',
  'VIELA S.A.',
  'RUC: 80054993-7',
  'Timbrado: 87654321',
  'Factura Electrónica: 005-005-0141150',
  'Fecha de emisión: 20/08/2026',
  'Total Pago. Gs 110.000',
  'Gravadas 10%: Gs 110.000',
  'IVA 10%: Gs 10.000',
);

describe('a different invoice that reuses the number', () => {
  beforeAll(newUser);

  it('is stored beside the XML it only shares a number with', async () => {
    expect((await postXml()).status).toBe(201);
    photoReads(OTHER);
    expect((await postPhoto()).status).toBe(201);
    expect((await stored()).map((i) => i.source).sort()).toEqual(['manual', 'ocr']);
  });

  it('refuses a photo whose date could not be read, rather than date it today', async () => {
    photoReads(
      lines('VIELA S.A.', 'RUC: 80054993-7', 'Factura: 005-005-0141151', 'Total: Gs 110.000', 'Gravadas 10%: Gs 110.000', 'IVA 10%: Gs 10.000'),
    );
    const res = await postPhoto();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/fecha/);
  });
});

describe('an XML beside the photo of a different invoice with the same number', () => {
  beforeAll(newUser);

  it('does not delete that photo', async () => {
    photoReads(OTHER);
    expect((await postPhoto()).status).toBe(201);
    expect((await postXml()).status).toBe(201);
    expect(await stored()).toHaveLength(2);
  });
});

describe('a photo of an invoice in dollars', () => {
  beforeAll(newUser);

  it('is refused and pointed at its XML, never stored as guaraníes', async () => {
    // Stored as Gs 1.538 on 2026-09-19: in dollars its arithmetic holds.
    photoReads(
      lines(
        'KuDE de Factura Electrónica',
        'AGROQUIMICA EJEMPLO S.A.',
        'RUC: 80054993-7',
        'Moneda: Dólar americano',
        'Fecha de emisión: 18/08/2026',
        'Total Pago. 1.538,00',
        'Gravadas 10%: 1.538,00',
        'IVA 10%: 139,82',
      ),
    );
    const res = await postPhoto();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/dólares/);
    expect(await stored()).toEqual([]);
  });
});
