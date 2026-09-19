import { describe, expect, it } from 'vitest';

import { parseBest, type ParsedReceipt } from '../src/services/receipt-parser';
import { layoutsOf, type VisionAnnotation } from '../src/services/vision-layout';
import { visionFixture, type VisionFixture } from './fixtures/vision';

/**
 * The client's real tickets, photographed badly on purpose: turned, taken
 * off-axis, curled, bowed. The promise is not that every such photo reads —
 * it is that none is stored with a wrong number. Each outcome must be the
 * paper's values, or a refusal that asks for the photo again (exactly the
 * conditions under which importPhoto answers 400).
 *
 * Before the arithmetic checks, a sweep like this one stored wrong fiscal
 * values without a word in 178 of 1.592 distorted photos; a keystone that
 * shrinks the right edge by 6% was enough to store a KuDE's IVA twice.
 */

type Fiscal = Pick<ParsedReceipt, 'total' | 'gravada5' | 'iva5' | 'gravada10' | 'iva10'>;

const MINAS: Fiscal = { total: 91_925, gravada5: 44_425, iva5: 2_115, gravada10: 47_500, iva10: 4_318 };
const PAPER: Record<Exclude<VisionFixture, 'rrtop-usd-kude'>, Fiscal> = {
  'minas281-ticket': MINAS,
  'minas281-ticket-retake': MINAS,
  'fox-kude': { total: 48_000, gravada5: 0, iva5: 0, gravada10: 48_000, iva10: 4_364 },
  'primavera-ticket': { total: 223_150, gravada5: 76_590, iva5: 3_647, gravada10: 146_589, iva10: 13_326 },
  'baratao-talonario': { total: 160_000, gravada5: 0, iva5: 0, gravada10: 160_000, iva10: 14_545 },
};

/** A gravada derived from its IVA carries the IVA's rounding: up to ~11 Gs. */
const TOLERANCE: Record<keyof Fiscal, number> = { total: 0, iva5: 1, iva10: 1, gravada5: 11, gravada10: 11 };

/** Would importPhoto refuse this reading? */
const refused = (p: ParsedReceipt) =>
  p.total == null ||
  p.totalsAgree === false ||
  p.nota != null ||
  p.missing.includes('IVA') ||
  (p.foreignCurrency != null && p.tipoCambio == null);

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

/** Page size, from the words themselves (the trimmed fixtures keep no page size). */
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
  ...[-8, -3, -1, 1, 3, 8, 90, 179.5, 180.5, 270].map(
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
  ...[-0.0003, -0.00015, 0.00015, 0.0003].map(
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
  ...[-36, -24, -12, 12, 24, 36].flatMap((d) => [
    [
      `curled ${d}px`,
      (a: VisionAnnotation, W: number) => warp(a, (x, y) => [x, y + d * ((2 * x - W) / W) ** 2]),
    ] as [string, (a: VisionAnnotation, W: number, H: number) => VisionAnnotation],
    [
      `bowed ${d}px`,
      (a: VisionAnnotation, W: number) => warp(a, (x, y) => [x, y + d * Math.sin((Math.PI * x) / W)]),
    ] as [string, (a: VisionAnnotation, W: number, H: number) => VisionAnnotation],
  ]),
];

describe('a badly taken photo is read right or refused — never stored wrong', () => {
  for (const name of Object.keys(PAPER) as (keyof typeof PAPER)[]) {
    it(name, () => {
      const original = visionFixture(name);
      const [W, H] = extent(original);
      const paper = PAPER[name];
      const wrong: string[] = [];
      let read = 0;

      for (const [label, distort] of DISTORTIONS) {
        const a = distort(original, W, H);
        const r = parseBest(layoutsOf(a));
        if (!r || refused(r.parsed)) continue;
        read++;
        const p = r.parsed;
        const off = (Object.keys(paper) as (keyof Fiscal)[]).filter(
          (k) => p[k] != null && Math.abs((p[k] as number) - (paper[k] as number)) > TOLERANCE[k],
        );
        if (off.length) wrong.push(`${label}: ${off.map((k) => `${k}=${p[k]}`).join(' ')}`);
      }

      expect(wrong).toEqual([]);
      // Refusing everything would pass the line above; most of these must read.
      expect(read).toBeGreaterThanOrEqual(DISTORTIONS.length * 0.6);
    });
  }
});

/**
 * The dollar invoice has no row in PAPER: its amounts are in dollars, and the
 * parser refuses it (no exchange rate on the photo, see photo-decision). What
 * must hold under the same distortions is that it never passes for guaraníes
 * — that is how Gs 1.538 was recorded for USD 1.538 on 2026-09-19.
 */
describe('a photo in another currency is never read as guaraníes', () => {
  it('rrtop-usd-kude', () => {
    const original = visionFixture('rrtop-usd-kude');
    const [W, H] = extent(original);
    let read = 0;

    for (const [label, distort] of DISTORTIONS) {
      const r = parseBest(layoutsOf(distort(original, W, H)));
      if (!r || r.parsed.total == null) continue;
      read++;
      expect(`${label}: ${r.parsed.foreignCurrency}`).toBe(`${label}: USD`);
    }
    // Half, not the tickets' 60%: this is a dense A4 form whose amounts sit in
    // a wide table, and a heavy curl or an upside-down page loses the total —
    // which is refused, never guessed.
    expect(read).toBeGreaterThanOrEqual(DISTORTIONS.length * 0.5);
  });
});
