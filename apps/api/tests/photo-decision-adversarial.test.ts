import { describe, expect, it } from 'vitest';

import { decidePhoto } from '../src/services/photo-decision';
import { fromExtraction, parseBest, type Extraction } from '../src/services/receipt-parser';
import { layoutsOf, type VisionAnnotation } from '../src/services/vision-layout';
import { aiFixture, type AiFixture } from './fixtures/ai';
import { visionFixture, type VisionFixture } from './fixtures/vision';

/**
 * Both readers under pressure at once: the photo taken badly (the same
 * distortions as receipt-photo-robustness) and the model answering wrongly in
 * the ways it really can — a reading scaled by ten that still adds up, the
 * buyer named as the issuer, a date a month out, items twice their size, a
 * factura called a credit note.
 *
 * The promise is the same as with one reader: what is stored is the paper's,
 * or nothing is. A refusal is always an acceptable outcome here; a stored
 * wrong figure never is.
 */

type Truth = { total: number; iva10: number; fecha: string; moneda: string | null };

const PAPER: Record<AiFixture, [VisionFixture, Truth] | null> = {
  minas281: ['minas281-ticket', { total: 91_925, iva10: 4_318, fecha: '2026-09-02', moneda: null }],
  'fox-kude': ['fox-kude', { total: 48_000, iva10: 4_364, fecha: '2026-09-01', moneda: null }],
  primavera: ['primavera-ticket', { total: 223_150, iva10: 13_326, fecha: '2026-09-01', moneda: null }],
  baratao: ['baratao-talonario', { total: 160_000, iva10: 14_545, fecha: '2026-09-16', moneda: null }],
  'usd-rrtop': ['rrtop-usd-kude', { total: 1_538, iva10: 139.82, fecha: '2026-08-18', moneda: 'USD' }],
  'ecop-exenta': null, // no Vision fixture for this photo
};

/** The buyer, as the fixtures mask them — and, on the dollar invoice, the client's company. */
const BUYER: Partial<Record<AiFixture, string>> = { 'usd-rrtop': '80175384' };

const scaled = (v: number | null, by: number) => (v == null ? null : v * by);

/** The ways the model has been wrong, or could be, on a photo it reads at all. */
const MISREADINGS: [string, (x: Extraction, buyer: string) => Extraction][] = [
  ['as read', (x) => x],
  [
    'every amount ten times over',
    (x) => ({
      ...x,
      total: scaled(x.total, 10),
      gravada5: scaled(x.gravada5, 10),
      gravada10: scaled(x.gravada10, 10),
      exentas: scaled(x.exentas, 10),
      iva5: scaled(x.iva5, 10),
      iva10: scaled(x.iva10, 10),
      totalIva: scaled(x.totalIva, 10),
      totalEnGuaranies: scaled(x.totalEnGuaranies, 10),
      items: x.items.map((it) => ({ ...it, total: scaled(it.total, 10), precioUnitario: scaled(it.precioUnitario, 10) })),
    }),
  ],
  ['the buyer named as the issuer', (x, buyer) => ({ ...x, emisorRuc: buyer, emisorDv: 8, receptorRuc: x.emisorRuc, cdc: null })],
  ['a date a month out', (x) => ({ ...x, fecha: x.fecha?.replace(/-(\d{2})-/, (_m, mm) => `-${String((Number(mm) % 12) + 1).padStart(2, '0')}-`) ?? null, cdc: null })],
  ['items twice their size', (x) => ({ ...x, items: x.items.map((it) => ({ ...it, total: scaled(it.total, 2) })) })],
  ['a factura called a credit note', (x) => ({ ...x, tipoDocumento: 'nota_credito' })],
  ['nothing read at all', (x) => ({ ...x, total: null, gravada5: null, gravada10: null, iva5: null, iva10: null, totalIva: null, items: [] })],
];

function warp(a: VisionAnnotation, f: (x: number, y: number) => [number, number]): VisionAnnotation {
  const copy = structuredClone(a);
  for (const pg of copy.pages ?? [])
    for (const b of pg.blocks ?? [])
      for (const p of b.paragraphs ?? [])
        for (const w of p.words ?? [])
          for (const v of w.boundingBox?.vertices ?? []) {
            const [x, y] = f(v.x ?? 0, v.y ?? 0);
            v.x = Math.round(x);
            v.y = Math.round(y);
          }
  return copy;
}

function extent(a: VisionAnnotation): [number, number] {
  let [w, h] = [0, 0];
  for (const pg of a.pages ?? [])
    for (const b of pg.blocks ?? [])
      for (const p of b.paragraphs ?? [])
        for (const word of p.words ?? [])
          for (const v of word.boundingBox?.vertices ?? []) {
            w = Math.max(w, v.x ?? 0);
            h = Math.max(h, v.y ?? 0);
          }
  return [w, h];
}

const DISTORTIONS: [string, (a: VisionAnnotation, W: number, H: number) => VisionAnnotation][] = [
  ['as taken', (a) => a],
  ...[-3, 3].map(
    (deg) =>
      [
        `turned ${deg}°`,
        (a: VisionAnnotation) => {
          const r = (deg * Math.PI) / 180;
          const [c, s] = [Math.cos(r), Math.sin(r)];
          return warp(a, (x, y) => [x * c - y * s, x * s + y * c]);
        },
      ] as [string, (a: VisionAnnotation, W: number, H: number) => VisionAnnotation],
  ),
  ...[-0.00015, 0.00015].map(
    (k) =>
      [
        `off-axis ${k}`,
        (a: VisionAnnotation, _W: number, H: number) =>
          warp(a, (x, y) => {
            const s = 1 + k * x;
            return [x / s, (y - H / 2) / s + H / 2];
          }),
      ] as [string, (a: VisionAnnotation, W: number, H: number) => VisionAnnotation],
  ),
  ['curled 24px', (a: VisionAnnotation, W: number) => warp(a, (x, y) => [x, y + 24 * ((2 * x - W) / W) ** 2])],
  ['bowed 24px', (a: VisionAnnotation, W: number) => warp(a, (x, y) => [x, y + 24 * Math.sin((Math.PI * x) / W)])],
];

describe('a bad photo and a wrong second reading store the paper, or nothing', () => {
  for (const [name, entry] of Object.entries(PAPER) as [AiFixture, [VisionFixture, Truth] | null][]) {
    if (!entry) continue;
    const [fixture, paper] = entry;

    it(`${name}`, () => {
      const original = visionFixture(fixture);
      const [W, H] = extent(original);
      const buyer = BUYER[name] ?? '1111111';
      const wrong: string[] = [];
      let stored = 0;

      for (const [how, distort] of DISTORTIONS) {
        const annotation = distort(original, W, H);
        const reading = parseBest(layoutsOf(annotation));
        const text = annotation.text ?? '';

        for (const [misread, mangle] of MISREADINGS) {
          const answer = fromExtraction(mangle(aiFixture(name), buyer));
          const decision = decidePhoto(reading?.parsed ?? null, answer, text, buyer);
          if (decision.kind !== 'store') continue;
          stored++;

          const p = decision.reading;
          const label = `${how} + ${misread}`;
          const off: string[] = [];
          if (p.total !== paper.total) off.push(`total=${p.total}`);
          if (Math.abs((p.iva10 ?? 0) - paper.iva10) > 1) off.push(`iva10=${p.iva10}`);
          if (p.fechaEmision?.toISOString().slice(0, 10) !== paper.fecha) off.push(`fecha=${p.fechaEmision?.toISOString().slice(0, 10)}`);
          if ((p.foreignCurrency ?? null) !== paper.moneda) off.push(`moneda=${p.foreignCurrency}`);
          // Items are stored as the invoice's own lines: they must add up to it.
          const sum = p.items.reduce((s, it) => s + it.total, 0);
          if (p.items.length && Math.abs(sum - (p.total ?? 0)) > 50) off.push(`items=${sum}`);
          if (off.length) wrong.push(`${label}: ${off.join(' ')}`);
        }
      }

      expect(wrong).toEqual([]);
      // Refusing everything would pass the line above; the good readings must go through.
      expect(stored).toBeGreaterThanOrEqual(DISTORTIONS.length);
    });
  }
});
